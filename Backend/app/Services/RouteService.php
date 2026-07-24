<?php

namespace App\Services;

use App\Enums\OptimizationProfile;
use App\Enums\OrderPriority;
use App\Enums\OrderStatus;
use App\Enums\RouteStatus;
use App\Helpers\RouteOptimizer;
use App\Helpers\RouteTimingCalculator;
use App\Models\DeliveryCenter;
use App\Models\DeliveryRoute;
use App\Models\Order;
use App\Models\Vehicle;
use App\Repositories\Contracts\DeliveryCenterRepositoryInterface;
use App\Repositories\Contracts\OrderRepositoryInterface;
use App\Repositories\Contracts\RouteRepositoryInterface;
use App\Repositories\Contracts\VehicleRepositoryInterface;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Illuminate\Support\Carbon;

class RouteService
{
    private const ROUTE_CACHE_TTL_SECONDS = 600;

    private const SERVICE_SECONDS_PER_STOP = 180;

    public function __construct(
        private readonly DeliveryCenterRepositoryInterface $centers,
        private readonly OrderRepositoryInterface $orders,
        private readonly VehicleRepositoryInterface $vehicles,
        private readonly RouteRepositoryInterface $routes,
    ) {}

    /**
     * @return array<int, array<string, mixed>>
     */
    public function generateRoutes(mixed $deliveryCenterId = null, ?Carbon $departureAt = null, ?string $date = null): array
    {
        if (!$date) {
            throw ValidationException::withMessages([
                'date' => __('A delivery date is required to generate routes.'),
            ]);
        }

        $departureAt ??= now();

        Log::info('route.generate.start', [
            'delivery_center_id' => $deliveryCenterId,
            'departure_at' => $departureAt->toIso8601String(),
            'date' => $date,
        ]);

        $centers = $this->resolveCenters($deliveryCenterId);
        $comparisons = [];

        foreach ($centers as $center) {
            // Prevent duplicates: clear existing planned routes for this center first
            $this->clearPlannedRoutesInternal($center->id);

            // Auto-capture unassigned orders in the center's area before generating
            $this->captureNearbyOrders($center, 10.0, $date);

            $batch = $this->processCenter($center, $departureAt, $date);
            $comparisons = array_merge($comparisons, $batch);
        }

        Log::info('route.generate.complete', ['comparisons' => count($comparisons)]);

        if ($comparisons === []) {
            Log::info('route.generate.skip', ['reason' => 'no_comparisons_generated']);
            return [];
        }

        return $comparisons;
    }

    public function generateRouteForVehicle(mixed $vehicleId, ?Carbon $departureAt = null): array
    {
        $departureAt ??= now();
        $vehicle = $this->vehicles->find($vehicleId);
        
        if (!$vehicle) {
            throw ValidationException::withMessages(['vehicle_id' => __('Vehicle not found.')]);
        }

        $center = $vehicle->deliveryCenter;
        $orders = \App\Models\Order::query()
            ->where('vehicle_id', $vehicleId)
            ->where('status', \App\Enums\OrderStatus::Assigned->value)
            ->get();

        if ($orders->isEmpty()) {
            throw ValidationException::withMessages(['vehicle_id' => __('No assigned orders for this vehicle.')]);
        }

        $optimizer = new \App\Helpers\RouteOptimizer((float) $center->latitude, (float) $center->longitude);
        
        // Split orders by priority
        $priorityOrders = $orders->filter(fn($o) => $o->priority === OrderPriority::Priority);
        $normalOrders = $orders->filter(fn($o) => $o->priority === OrderPriority::Normal);
        
        $priorityTour = $optimizer->buildShortestDistanceTour($priorityOrders);
        $normalTour = $optimizer->buildShortestDistanceTour($normalOrders);
        
        $tour = array_merge($priorityTour, $normalTour);
        
        $batchId = (string) \Illuminate\Support\Str::uuid();
        $route = $this->persistOptimizedRoute(
            $center,
            $vehicle,
            $tour,
            $departureAt,
            \App\Enums\OptimizationProfile::ShortestDistance,
            $batchId
        );

        return [
            'comparison_batch_id' => $batchId,
            'delivery_center_id' => $center->id,
            'vehicle_id' => $vehicle->id,
            'route' => (new \App\Http\Resources\RouteOptimizationResource($route))->toArray(request()),
        ];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function regenerateRoutesForCenter(mixed $deliveryCenterId, ?Carbon $departureAt = null, ?string $date = null): array
    {
        $center = $this->centers->find($deliveryCenterId);
        if (! $center instanceof DeliveryCenter) {
            throw ValidationException::withMessages([
                'center_id' => __('The selected delivery center is invalid.'),
            ]);
        }

        Log::info('route.regenerate.start', ['delivery_center_id' => $deliveryCenterId]);

        $this->clearPlannedRoutesInternal($deliveryCenterId);

        $this->captureNearbyOrders($center, 10.0, $date);

        return $this->generateRoutes($deliveryCenterId, $departureAt, $date);
    }

    /**
     * Internal helper to clear planned routes and reset their orders/vehicles.
     */
    private function clearPlannedRoutesInternal(mixed $deliveryCenterId): void
    {
        DB::transaction(function () use ($deliveryCenterId): void {
            $planned = $this->routes->plannedRoutesForCenter($deliveryCenterId);

            foreach ($planned as $route) {
                // Unassign from vehicle but keep status (e.g. Assigned or Delivered)
                foreach ($route->routeStops as $stop) {
                    if ($stop->order && $stop->order->status !== OrderStatus::Delivered) {
                        $this->orders->update($stop->order, [
                            'vehicle_id' => null,
                            'status' => OrderStatus::Pending,
                        ]);
                    }
                }
                
                if ($route->vehicle) {
                    // If it was in progress, it's likely safe to make available, 
                    // but we should probably just reset load.
                    $route->vehicle->update(['current_load' => 0]);
                }
                
                $this->routes->deleteRoute($route);
            }
        });
    }


    public function findRouteForRead(mixed $routeId): ?DeliveryRoute
    {
        $key = $this->routeCacheKey($routeId);
        $cached = Cache::get($key);

        if ($cached instanceof DeliveryRoute) {
            return $cached;
        }

        $route = $this->routes->findWithRelations($routeId);

        if ($route instanceof DeliveryRoute) {
            Cache::put($key, $route, self::ROUTE_CACHE_TTL_SECONDS);
        }

        return $route;
    }

    public function forgetRouteCache(mixed $routeId): void
    {
        Cache::forget($this->routeCacheKey($routeId));
    }

    /**
     * @return Collection<int, DeliveryCenter>
     */
    private function resolveCenters(mixed $deliveryCenterId): Collection
    {
        if ($deliveryCenterId !== null) {
            $center = $this->centers->find($deliveryCenterId);
            if (! $center instanceof DeliveryCenter) {
                throw ValidationException::withMessages([
                    'delivery_center_id' => __('The selected delivery center is invalid.'),
                ]);
            }

            return collect([$center]);
        }

        return $this->centers->all();
    }

    private function processCenter(DeliveryCenter $center, Carbon $departureAt, string $date): array
    {
        $pending = $this->orders->pendingForCenterOnDate($center->id, $date)
            ->filter(function ($o) use ($center) {
                return \App\Helpers\DistanceHelper::kmBetween(
                    (float) $o->latitude, (float) $o->longitude,
                    (float) $center->latitude, (float) $center->longitude
                ) <= 10.0;
            });

        if ($pending->isEmpty()) {
            Log::info('route.generate.center.skip', [
                'delivery_center_id' => $center->id,
                'reason' => 'no_pending_orders_within_range',
            ]);

            return [];
        }

        $vehicles = $this->vehicles->availableForCenter($center->id);
        if ($vehicles->isEmpty()) {
            throw ValidationException::withMessages([
                'delivery_center_id' => __('No available vehicles exist for this delivery center.'),
            ]);
        }

        $clusters = $this->clusterOrdersByVehicleCapacity(
            $pending,
            $vehicles,
            (float) $center->latitude,
            (float) $center->longitude
        );

        $pendingRoutes = [];
        foreach ($clusters as $vehicleId => $bucket) {
            if ($bucket->isEmpty()) {
                continue;
            }

            /** @var Vehicle $vehicle */
            $vehicle = $vehicles->firstWhere('id', $vehicleId);
            $batchId = (string) Str::uuid();

            $priorityOrders = $bucket->filter(fn($o) => $o->priority === OrderPriority::Priority);
            $normalOrders = $bucket->filter(fn($o) => $o->priority === OrderPriority::Normal);

            $optimizer = new RouteOptimizer((float) $center->latitude, (float) $center->longitude);
            
            $priorityTour = $optimizer->buildShortestDistanceTour($priorityOrders);
            $normalTour = $optimizer->buildShortestDistanceTour($normalOrders);
            
            $finalTour = array_merge($priorityTour, $normalTour);

            $points = collect([[ (float) $center->longitude, (float) $center->latitude ]])
                ->concat(collect($finalTour)->map(fn($s) => [ (float) $s->longitude, (float) $s->latitude ]))
                ->push([ (float) $center->longitude, (float) $center->latitude ])
                ->map(fn($p) => implode(',', $p))
                ->implode(';');

            $pendingRoutes[$vehicleId] = [
                'vehicle' => $vehicle,
                'tour' => $finalTour,
                'points' => $points,
                'batchId' => $batchId
            ];
        }

        if (empty($pendingRoutes)) {
            return [];
        }

        $geometries = [];
        try {
            $responses = Http::pool(function (\Illuminate\Http\Client\Pool $pool) use ($pendingRoutes) {
                $requests = [];
                foreach ($pendingRoutes as $vehicleId => $data) {
                    $requests[] = $pool->as((string)$vehicleId)->timeout(5)->get("https://router.project-osrm.org/route/v1/driving/{$data['points']}", [
                        'overview' => 'full',
                        'geometries' => 'geojson',
                    ]);
                }
                return $requests;
            });

            foreach ($responses as $vehicleId => $response) {
                $geom = null;
                if ($response instanceof \Illuminate\Http\Client\Response && $response->successful()) {
                    $data = $response->json();
                    if (($data['code'] ?? '') === 'Ok' && !empty($data['routes'][0]['geometry']['coordinates'])) {
                        $geom = array_map(fn($p) => [$p[1], $p[0]], $data['routes'][0]['geometry']['coordinates']);
                    }
                }
                $geometries[$vehicleId] = $geom;
            }
        } catch (\Exception $e) {
            Log::error('route.osrm.pool_failed', ['error' => $e->getMessage()]);
        }

        $comparisons = [];

        DB::transaction(function () use ($pendingRoutes, $geometries, $center, $departureAt, &$comparisons): void {
            foreach ($pendingRoutes as $vehicleId => $data) {
                $routeDistance = $this->persistOptimizedRoute(
                    $center,
                    $data['vehicle'],
                    $data['tour'],
                    $departureAt,
                    OptimizationProfile::ShortestDistance,
                    $data['batchId'],
                    $geometries[$vehicleId] ?? null
                );

                $comparisons[] = [
                    'comparison_batch_id' => $data['batchId'],
                    'delivery_center_id' => $center->id,
                    'vehicle_id' => $vehicleId,
                    'shortest_distance_route' => $routeDistance->fresh(['deliveryCenter', 'vehicle', 'routeStops.order']),
                ];

                $this->forgetRouteCache($routeDistance->id);
            }
        });

        return $comparisons;
    }

    /**
     * @param  array<int, Order>  $orderedStops
     */
    private function persistOptimizedRoute(
        DeliveryCenter $center,
        Vehicle $vehicle,
        array $orderedStops,
        Carbon $departureAt,
        OptimizationProfile $profile,
        string $comparisonBatchId,
        ?array $geometry = null
    ): DeliveryRoute {
        $optimizer = new RouteOptimizer((float) $center->latitude, (float) $center->longitude);
        $distanceKm = $optimizer->tourDistanceKm($orderedStops);

        $timing = (new RouteTimingCalculator)->compute(
            $departureAt,
            $orderedStops,
            (float) $center->latitude,
            (float) $center->longitude,
            (float) $vehicle->average_speed,
            self::SERVICE_SECONDS_PER_STOP,
        );

        // Fetch OSRM geometry if not provided
        if ($geometry === null) {
            $geometry = $this->fetchGeometry($center, $orderedStops);
        }

        $route = $this->routes->create([
            'delivery_center_id' => $center->id,
            'vehicle_id' => $vehicle->id,
            'comparison_batch_id' => $comparisonBatchId,
            'optimization_profile' => $profile,
            'total_distance' => round($distanceKm, 3),
            'total_time' => $timing['total_seconds'],
            'status' => RouteStatus::Planned,
            'next_stop_sequence' => null,
            'departure_at' => $departureAt,
            'geometry' => $geometry,
        ]);

        foreach ($orderedStops as $index => $order) {
            $legKm = $timing['leg_distances_km'][$index] ?? 0.0;

            $route->routeStops()->create([
                'order_id' => $order->id,
                'sequence' => $index + 1,
                'distance_from_previous' => round((float) $legKm, 3),
                'estimated_arrival_time' => $timing['etas'][$index] ?? null,
            ]);

            $this->orders->update($order, [
                'status' => OrderStatus::Assigned,
                'vehicle_id' => $vehicle->id,
            ]);
        }

        return $route->fresh(['deliveryCenter', 'vehicle', 'routeStops.order']);
    }

    /**
     * @param  Collection<int, Vehicle>  $vehicles
     * @param  Collection<int, Order>  $orders
     */
    private function assertCapacityCoversOrders(Collection $vehicles, Collection $orders): void
    {
        $capacity = (int) $vehicles->sum('capacity');

        if ($capacity < $orders->count()) {
            Log::warning('route.capacity.insufficient', [
                'total_capacity' => $capacity,
                'total_orders' => $orders->count(),
                'message' => 'Combined vehicle capacity is nominally insufficient. Last vehicle will pick up the slack.'
            ]);
        }
    }

    /**
     * @param  Collection<int, Order>  $orders
     * @param  Collection<int, Vehicle>  $vehicles
     * @return array<int, Collection<int, Order>>
     */
    private function clusterOrdersByVehicleCapacity(
        Collection $orders,
        Collection $vehicles,
        float $depotLat,
        float $depotLon
    ): array {
        $sorted = $orders->sort(function (Order $a, Order $b) use ($depotLat, $depotLon) {
            if ($a->priority->rank() !== $b->priority->rank()) {
                return $b->priority->rank() <=> $a->priority->rank();
            }

            $angleA = atan2($a->latitude - $depotLat, $a->longitude - $depotLon);
            $angleB = atan2($b->latitude - $depotLat, $b->longitude - $depotLon);

            if ($angleA === $angleB) {
                return $a->id <=> $b->id;
            }

            return $angleA <=> $angleB;
        })->values();

        $buckets = [];
        $cursor = 0;
        $totalOrders = $sorted->count();

        foreach ($vehicles->sortBy('id')->values() as $index => $vehicle) {
            $remainingOrders = $totalOrders - $cursor;
            if ($remainingOrders <= 0) {
                $buckets[$vehicle->id] = collect();
                continue;
            }

            $remainingVehicles = $vehicles->count() - $index;
            
            // Calculate a fair share of orders for this vehicle
            $fairShare = (int) ceil($remainingOrders / $remainingVehicles);
            
            // Respect both the fair share and the strict capacity limit
            $take = min($fairShare, $vehicle->capacity, $remainingOrders);
            
            $slice = $sorted->slice($cursor, $take)->values();
            
            $cursor += $slice->count();
            $buckets[$vehicle->id] = $slice;
        }

        return $buckets;
    }

    private function routeCacheKey(mixed $routeId): string
    {
        return 'delivery_route:'.$routeId;
    }

    private function fetchGeometry(DeliveryCenter $center, array $stops): array
    {
        if (empty($stops)) {
            return [];
        }

        $points = collect([[ (float) $center->longitude, (float) $center->latitude ]])
            ->concat(collect($stops)->map(fn($s) => [ (float) $s->longitude, (float) $s->latitude ]))
            ->push([ (float) $center->longitude, (float) $center->latitude ])
            ->map(fn($p) => implode(',', $p))
            ->implode(';');

        try {
            $response = Http::get("https://router.project-osrm.org/route/v1/driving/{$points}", [
                'overview' => 'full',
                'geometries' => 'geojson',
            ]);

            if ($response->successful()) {
                $data = $response->json();
                if (($data['code'] ?? '') === 'Ok' && !empty($data['routes'][0]['geometry']['coordinates'])) {
                    // Convert [lng, lat] to [lat, lng] for Leaflet
                    return array_map(fn($p) => [$p[1], $p[0]], $data['routes'][0]['geometry']['coordinates']);
                }
            }
        } catch (\Exception $e) {
            Log::error('route.osrm.failed', ['error' => $e->getMessage()]);
        }

        return [];
    }
    private function captureNearbyOrders(DeliveryCenter $center, float $radiusKm = 10.0, ?string $date = null): void
    {
        $zoneService = app(\App\Services\ServiceZoneService::class);
        $zone = \App\Models\ServiceZone::where('delivery_center_id', $center->id)->first();

        // If no specific zone exists, we'll still proceed for orphaned orders (dist-based capture)
        // But we won't be able to "steal" orders from other hubs without a Voronoi zone.

        // Find all pending/assigned orders that are NOT already in this center (including orphans)
        $candidates = Order::query()
            ->whereIn('status', [OrderStatus::Pending, OrderStatus::Assigned])
            ->whereNull('delivery_center_id')
            ->get();

        foreach ($candidates as $order) {
            $dist = \App\Helpers\DistanceHelper::kmBetween(
                (float)$order->latitude, (float)$order->longitude,
                (float)$center->latitude, (float)$center->longitude
            );

            // Orphans are fair game for any center within the capture radius
            if ($dist <= $radiusKm) {
                // Safety check: don't steal if it's already in an InProgress route
                if ($order->status === OrderStatus::Assigned) {
                    $stop = $order->routeStop;
                    if ($stop && $stop->route && $stop->route->status === RouteStatus::InProgress) {
                        continue; 
                    }
                }

                $updateData = [
                    'delivery_center_id' => $center->id,
                    'status' => OrderStatus::Pending,
                    'vehicle_id' => null,
                ];

                if ($date) {
                    $updateData['delivery_date'] = $date;
                }

                $this->orders->update($order, $updateData);
            }
        }
    }
}
