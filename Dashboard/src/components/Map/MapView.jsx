import React, { useMemo, useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, Circle, useMapEvents, Tooltip, Polygon, ZoomControl } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Leaflet Icon Fix for Vite/Vercel
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import shadowIcon from 'leaflet/dist/images/marker-shadow.png'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: shadowIcon,
})
import { centerIcon, orderIcon, numberedStopIcon, vehicleIcon, vehicleIconHighlighted } from './mapIcons'
import { stopLatLng, getDistance } from '../../utils/coords'
import { formatId } from '../../utils/format'
import { extractRouteCoordinates } from '../../utils/routeGeometry'
import { buildLegPath } from '../../utils/simplePlaybackPath'
import { useApp } from '../../context/AppContext'
import * as api from '../../services/api'
import { Share2, Map as MapIcon, MessageSquare, Copy } from 'lucide-react'
import { buildGoogleMapsLink } from '../../utils/maps'
import Modal from '../UI/Modal'

const ROUTE_COLORS = [
  { primary: '#2563eb', glow: '#60a5fa' }, // Blue
  { primary: '#10b981', glow: '#34d399' }, // Emerald
  { primary: '#8b5cf6', glow: '#a78bfa' }, // Violet
  { primary: '#f59e0b', glow: '#fbbf24' }, // Amber
  { primary: '#ef4444', glow: '#f87171' }, // Red
  { primary: '#06b6d4', glow: '#22d3ee' }, // Cyan
]

function getMarkerColor(status, routeColor = null) {
  switch (status) {
    case 'delivered':
      return routeColor || '#16a34a'
    case 'current':
      return '#2563eb'
    default:
      return '#6b7280'
  }
}

function getStopStatus(route, stop) {
  if (stop?.status) return stop.status
  if (route?.status === 'completed') return 'delivered'
  if (route?.status !== 'in_progress') return 'pending'

  const currentSequence = Number(route?.next_stop_sequence ?? 1)
  const stopSequence = Number(stop?.sequence ?? 0)

  if (stopSequence < currentSequence) return 'delivered'
  if (stopSequence === currentSequence) return 'current'
  return 'pending'
}

function FitBounds({ bounds }) {
  const map = useMap()
  useEffect(() => {
    if (bounds && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 12 })
    }
  }, [map, bounds])
  return null
}

function MapClickHandler({ onMapClick }) {
  useMapEvents({
    click: () => {
      onMapClick()
    },
  })
  return null
}

function MapZoomListener({ setZoom }) {
  const map = useMapEvents({
    zoomend: () => setZoom(map.getZoom()),
  })
  useEffect(() => setZoom(map.getZoom()), [map, setZoom])
  return null
}

function MapResize({ routeId }) {
  const map = useMap()
  useEffect(() => {
    const t = requestAnimationFrame(() => {
      map.invalidateSize()
    })
    return () => cancelAnimationFrame(t)
  }, [map, routeId])
  return null
}

function FlyToFocus({ focus }) {
  const map = useMap()
  useEffect(() => {
    if (focus?.lat && focus?.lng) {
      map.flyTo([focus.lat, focus.lng], focus.zoom || 12, {
        duration: 1.5,
        easeLinearity: 0.25,
      })
    }
  }, [map, focus])
  return null
}

export default function MapView({
  showOrderPins = true,
}) {
  const {
    mapFocus,
    draftDeliveries,
    routesList,
    selectedCenterId,
    setSelectedCenterId,
    generateRoutesAction,
    loading,
    simulationPhase,
    toast,
    setMapFocus,
    startFleetSimulation,
    pauseFleetSimulation,
    resumeFleetSimulation,
    resetFleetSimulation,
    activeMultiRoutes,
    setActiveRouteBase,
    activeOrderId,
    setActiveOrderId,
    resetSelection,
    vehicles,
    centers,
    orders,
    activeRoute,
    vehiclePosition,
    refreshOrders,
    routePlaybackCoords,
    routePlaybackStep,
    serviceZones,
    showZones,
  } = useApp()

  const [showShareModal, setShowShareModal] = useState(false)
  const [currentZoom, setCurrentZoom] = useState(12)

  // Dynamically scale vehicles so they don't look massive when zoomed out
  // Also boost size significantly during active simulation as requested
  const isSimulating = simulationPhase === 'running' || simulationPhase === 'paused'
  const baseScale = Math.max(0.4, Math.min(1.5, Math.pow(1.15, currentZoom - 12)))
  const vehicleScale = isSimulating ? baseScale * 1.6 : baseScale

  const handleOrderClick = async (order) => {
    setActiveOrderId(order.id)
    if (!centers.length) return

    // Find nearest center
    const nearby = centers.map((c) => {
      const dist = getDistance(
        Number(order.latitude),
        Number(order.longitude),
        Number(c.latitude),
        Number(c.longitude)
      )
      return { ...c, dist }
    })

    const nearest = nearby.sort((a, b) => a.dist - b.dist)[0]

    if (nearest) {
      if (nearest.dist > 10) {
        toast(`Nearest center is ${nearest.dist.toFixed(1)}km away (out of service range).`, 'error')
        return
      }

      setSelectedCenterId(nearest.id)

      // Auto-zoom to center
      setMapFocus({
        lat: Number(nearest.latitude),
        lng: Number(nearest.longitude),
        zoom: 12
      })

      try {
        // If order has no hub assigned, assign it to the nearest one first
        if (!order.delivery_center_id) {
          await api.assignOrder(order.id)
          await refreshOrders() // Sync local state
        }

        toast(`Hub: ${nearest.name} (${nearest.dist.toFixed(1)} km)`)
      } catch (err) {
        console.error('Dispatch error:', err)
        toast('Failed to link order to hub.', 'error')
      }
    }
  }

  const handleOpenMaps = () => {
    const link = buildGoogleMapsLink(activeRoute, centers)
    if (link) {
      toast('Opening Google Maps...', 'info')
      window.open(link, '_blank')
      setShowShareModal(false)
    }
  }

  const handleCopyLink = () => {
    const link = buildGoogleMapsLink(activeRoute, centers)
    if (link) {
      navigator.clipboard.writeText(link)
      toast('Route link copied to clipboard!')
      setShowShareModal(false)
    }
  }

  const handleSendWhatsApp = () => {
    const link = buildGoogleMapsLink(activeRoute, centers)
    if (link) {
      const message = encodeURIComponent(`Your delivery route: ${link}`)
      window.open(`https://wa.me/?text=${message}`, '_blank')
      toast('Opening WhatsApp...', 'info')
      setShowShareModal(false)
    }
  }

  const displayedRoutes = useMemo(
    () => (activeMultiRoutes?.length > 0 ? activeMultiRoutes : (activeRoute ? [activeRoute] : [])),
    [activeMultiRoutes, activeRoute]
  )

  const activeRouteOrderIds = useMemo(() => {
    const ids = new Set()
    activeMultiRoutes.forEach(r => {
      r.stops?.forEach(s => ids.add(String(s.order_id)))
    })
    return ids
  }, [activeMultiRoutes])

  useEffect(() => {
    if (displayedRoutes.length === 0) return
    displayedRoutes.forEach((route) => {
      // Internal tracking logic
    })
  }, [displayedRoutes])

  const bounds = useMemo(() => {
    const b = L.latLngBounds([])
    if (!selectedCenterId) {
      // Include India's bounds so reset always zooms out to country level
      b.extend([35.6745, 68.1690]) // North-West
      b.extend([8.0883, 97.3956])  // South-East
    }
    centers.forEach((c) => {
      b.extend([Number(c.latitude), Number(c.longitude)])
    })
    orders.forEach((o) => {
      b.extend([Number(o.latitude), Number(o.longitude)])
    })
    draftDeliveries.forEach((d) => {
      if (Number.isFinite(d.lat) && Number.isFinite(d.lng)) {
        b.extend([d.lat, d.lng])
      }
    })
    routesList.forEach((r) => {
      if (r.status !== 'completed') {
        extractRouteCoordinates(r).forEach((p) => b.extend(p))
      }
    })
    if (vehiclePosition) {
      b.extend([Number(vehiclePosition.lat), Number(vehiclePosition.lng)])
    }
    return b.isValid() ? b : null
  }, [centers, orders, draftDeliveries, routesList, vehiclePosition])

  /** Stable key avoids full map teardown on route selection (fixes polyline flicker & lost GL state). */
  const mapInstanceKey = 'logiroute-map'

  return (
    <div className="relative h-full w-full overflow-hidden lg:rounded-2xl lg:border lg:border-zinc-200 lg:dark:border-zinc-800">
      <MapContainer
        key={mapInstanceKey}
        center={[20.5937, 78.9629]}
        zoom={5}
        preferCanvas={true}
        className="z-0 h-full w-full"
        scrollWheelZoom
        zoomControl={false}
        style={{ height: '100%', width: '100%' }}
      >
        <ZoomControl position={window.innerWidth < 1024 ? 'topright' : 'topleft'} />
        <MapZoomListener setZoom={setCurrentZoom} />
        <MapResize routeId={mapInstanceKey} />
        <FlyToFocus focus={mapFocus} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {showZones && serviceZones.map((zone, idx) => {
          const color = ROUTE_COLORS[idx % ROUTE_COLORS.length].primary
          return (
            <Polygon
              key={`zone-${zone._id}-${idx}`}
              positions={zone.polygon_coordinates}
              pathOptions={{
                fillColor: color,
                fillOpacity: 0.1,
                color: color,
                weight: 1,
                dashArray: '5, 5'
              }}
            >
              <Tooltip sticky>Zone: {zone.delivery_center?.name || 'Loading...'}</Tooltip>
            </Polygon>
          )
        })}
        <MapClickHandler onMapClick={() => setActiveOrderId(null)} />
        {bounds && !selectedCenterId && <FitBounds bounds={bounds} />}
        {(simulationPhase === 'running' || simulationPhase === 'paused') && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-1000 bg-zinc-900/90 text-white px-4 py-2 rounded-full shadow-2xl flex items-center gap-3 border border-white/10 backdrop-blur-md">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce"></span>
            </div>
            <span className="text-xs font-bold uppercase tracking-widest">
              {simulationPhase === 'paused'
                ? 'Fleet playback paused'
                : 'Fleet playback running'}
            </span>
          </div>
        )}

        <div className="absolute top-4 right-4 z-1000 flex flex-col gap-2">
          <button
            onClick={() => {
              resetSelection()
              toast('Map reset to initial state.')
            }}
            className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-bold text-zinc-900 shadow-xl ring-1 ring-zinc-900/5 hover:bg-zinc-50 transition-all dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Reset Map
          </button>
        </div>

        {centers.map((c) => {
          const position = stopLatLng(c)
          if (position[0] === 0 && position[1] === 0) return null

          return (
            <React.Fragment key={`c-group-${c.id}`}>
              <Marker
                position={position}
                icon={centerIcon()}
                eventHandlers={{
                  click: () => {
                    setSelectedCenterId(c.id)
                    setMapFocus({
                      lat: Number(c.latitude),
                      lng: Number(c.longitude),
                      zoom: 12
                    })
                    // Clear search/selection
                    setActiveOrderId(null)
                    // Reset and Regenerate
                    generateRoutesAction(c.id)
                  }
                }}
              >
                {String(selectedCenterId) !== String(c.id) && (
                  <Tooltip direction="top" offset={[0, -10]} opacity={0.9}>
                    <div className="text-[11px] font-bold text-zinc-900">{c.name}</div>
                  </Tooltip>
                )}
                {simulationPhase === 'idle' && (
                  <Popup closeButton={false} className="center-mini-popup">
                    <div className="text-[11px] font-bold text-zinc-900 !m-0 !p-0">{c.name}</div>
                  </Popup>
                )}
              </Marker>
            </React.Fragment>
          )
        })}

        {vehicles?.filter(v => {
          const vid = String(v.id ?? v._id)
          const isSimulating = !!routePlaybackCoords?.[vid]
          
          // Hide busy vehicles unless they are part of an active simulation playback
          if (!v.is_available && !isSimulating) return false;
          
          // Only show vehicles belonging to the selected center if one is active
          if (selectedCenterId && String(v.delivery_center_id) !== String(selectedCenterId)) return false;
          
          return true;
        }).map((v, i) => {
          const center = centers.find((c) => String(c.id) === String(v.delivery_center_id))
          if (!center) return null

          const depot = stopLatLng(center)
          if (depot[0] === 0 && depot[1] === 0) return null

          const fallbackPosition = [depot[0] - 0.003, depot[1] + i * 0.004]
          const vid = String(v.id ?? v._id)
          const path = routePlaybackCoords?.[vid]
          const step = routePlaybackStep?.[vid]
          const playbackActive =
            simulationPhase === 'running' ||
            simulationPhase === 'paused' ||
            simulationPhase === 'completed'
          
          // Current real-time position from DB if not in simulation
          const realTimePosition = [Number(v.latitude), Number(v.longitude)]
          const hasRealTimeCoords = 
            Number.isFinite(realTimePosition[0]) && 
            Number.isFinite(realTimePosition[1]) && 
            !(realTimePosition[0] === 0 && realTimePosition[1] === 0)

          let position = hasRealTimeCoords ? realTimePosition : fallbackPosition
          
          if (playbackActive && path && path.length && typeof step === 'number') {
            position = path[Math.min(step, path.length - 1)]
          }

          // Check if this vehicle belongs to the currently selected active route
          const isActiveVehicle = activeRoute && (
            String(activeRoute.vehicle_id || activeRoute.vehicle?.id) === vid
          )
          const activeRouteIdx = isActiveVehicle
            ? displayedRoutes.findIndex(r => String(r.vehicle_id || r.vehicle?.id) === vid)
            : -1
          
          // Force bright red during simulation for high visibility as requested
          const highlightColor = playbackActive 
            ? '#ff0000' 
            : (activeRouteIdx >= 0 ? ROUTE_COLORS[activeRouteIdx % ROUTE_COLORS.length].primary : '#2563eb')

          return (
            <Marker
              key={`v-${vid}`}
              position={position}
              icon={isActiveVehicle
                ? vehicleIconHighlighted(highlightColor, vehicleScale)
                : vehicleIcon(v.is_available ? 'available' : 'busy', vehicleScale)
              }
              zIndexOffset={isActiveVehicle ? 1000 : (playbackActive ? 950 : 0)}
            >
              <Tooltip direction="bottom" offset={[0, 10]} opacity={1} className="vehicle-mini-tooltip border-0 bg-transparent shadow-none">
                <div className="flex items-center rounded-md bg-white px-2 py-1 leading-tight shadow-md border border-zinc-200">
                  <span className="text-[10px] font-bold text-zinc-900">{v.name}</span>
                </div>
              </Tooltip>
            </Marker>
          )
        })}

        {centers.filter(c => String(c.id) === String(selectedCenterId)).map((c) => {
          const position = stopLatLng(c)
          if (position[0] === 0 && position[1] === 0) return null

          return (
            <Circle
              key={`radius-${c.id}`}
              center={position}
              radius={10000}
              pathOptions={{
                color: '#3b82f6',
                fillColor: '#3b82f6',
                fillOpacity: 0.1,
                weight: 1,
              }}
            />
          )
        })}

        {showOrderPins && orders.filter(o => {
          if (o.status === 'delivered') return false
          // If this order is part of an active route being displayed, hide its generic pin
          return !activeRouteOrderIds.has(String(o.id))
        }).map((o) => {
            const position = stopLatLng(o)
            if (position[0] === 0 && position[1] === 0) return null // Skip invalid coords

            const distances = centers.map(c => 
              getDistance(position[0], position[1], Number(c.latitude), Number(c.longitude))
            )
            const minDistance = distances.length > 0 ? Math.min(...distances) : Infinity
            const isOutOfRange = minDistance > 10

            const isPriority = o.priority === 'priority'
            const color = isOutOfRange ? '#71717a' : (isPriority ? '#ef4444' : (o.status === 'assigned' ? '#10b981' : '#6b7280'))
            
            return (
              <Marker
                key={`o-${o.id}-${o.priority}`}
                position={position}
                icon={orderIcon(color, isPriority)}
                eventHandlers={{
                  click: () => handleOrderClick(o),
                }}
              >
                <Tooltip direction="top" offset={[0, -10]} opacity={0.9}>
                  <div className="text-[10px] font-bold px-1">#{formatId(o.id)}</div>
                </Tooltip>
                {activeOrderId === o.id && (
                  <Popup autoClose={false} closeOnClick={false}>
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between items-start">
                        <strong className="text-sm">Order #{formatId(o.id)}</strong>
                        {isOutOfRange && (
                          <span className="bg-red-100 text-red-700 text-[9px] px-1.5 py-0.5 rounded font-black uppercase">
                            Out of Range
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-zinc-600 dark:text-zinc-400">{o.address}</span>
                      
                      <div className="mt-2 flex flex-col gap-2 border-t pt-2 border-zinc-100 dark:border-zinc-800">
                        <div className="flex justify-between items-center text-[10px] font-bold">
                          <span className="uppercase text-zinc-500">{o.status}</span>
                          <span className={isOutOfRange ? 'text-red-500' : 'text-emerald-500'}>
                            {minDistance === Infinity ? 'No centers' : `${minDistance.toFixed(1)} km`}
                          </span>
                        </div>

                        {isOutOfRange ? (
                          <div className="bg-red-50 dark:bg-red-900/20 p-2 rounded-lg border border-red-100 dark:border-red-900/30 text-[10px] text-red-600 dark:text-red-400 font-bold leading-tight">
                            No nearby delivery center found within 10km.
                          </div>
                        ) : (
                          <button
                            disabled={loading.generate}
                            onClick={() => {
                              setSelectedCenterId(o.delivery_center_id)
                              generateRoutesAction(o.delivery_center_id)
                            }}
                            className="w-full rounded-lg bg-blue-600 px-2 py-1.5 text-[10px] font-bold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                          >
                            {loading.generate ? 'Generating...' : 'Generate Route for this Hub'}
                          </button>
                        )}
                        
                        <button
                          onClick={() => setActiveOrderId(null)}
                          className="w-full rounded-lg bg-zinc-100 px-2 py-1 text-[10px] font-medium text-zinc-600 hover:bg-zinc-200 transition-colors dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                        >
                          Close Popup
                        </button>
                      </div>
                    </div>
                  </Popup>
                )}
              </Marker>
            )
        })}

        {draftDeliveries.map((d) => (
          <Marker
            key={`draft-${d.id}`}
            position={[d.lat, d.lng]}
            icon={orderIcon()}
          >
            <Popup>
              <strong>Delivery Location</strong>
              <br />
              {d.address}
            </Popup>
          </Marker>
        ))}

        {/* Render numbered stops for all active routes */}
        {(() => {
          let globalStopCount = 0;
          return displayedRoutes
            .map((route, routeIdx) => {
              const vid = String(route.vehicle?.id ?? route.vehicle_id)
              const step = routePlaybackStep?.[vid]
              const path = routePlaybackCoords?.[vid]

              const stopIndices = {};
              if (simulationPhase !== 'idle' && path?.length) {
                 const sortedStops = [...(route.stops || [])].sort((a,b) => a.sequence - b.sequence);
                 let searchStart = 0;
                 sortedStops.forEach(s => {
                    const [slat, slng] = stopLatLng(s);
                    let minDistSq = Infinity;
                    let minIdx = searchStart;
                    for (let i = searchStart; i < path.length; i++) {
                       const distSq = (slat - path[i][0]) ** 2 + (slng - path[i][1]) ** 2;
                       if (distSq < minDistSq) { 
                           minDistSq = distSq; 
                           minIdx = i; 
                       }
                       // If we've found a close point and the distance starts increasing significantly,
                       // we've passed the local minimum (the stop). Break to prevent matching a return trip.
                       if (minDistSq < 1e-5 && distSq > minDistSq + 1e-5) {
                          break;
                       }
                    }
                    stopIndices[s.sequence] = minIdx;
                    searchStart = minIdx; // Next stop searches from here onwards
                 });
              }

              const routeColor = ROUTE_COLORS[routeIdx % ROUTE_COLORS.length].primary;

              return route.stops
                ?.filter(s => {
                  // Hide delivered stops from the map as requested
                  const status = getStopStatus(route, s);
                  return status !== 'delivered';
                })
                .map((s, idx) => {
                globalStopCount++;
                const [lat, lng] = stopLatLng(s)
                
                let stopStatus;
                if (simulationPhase === 'idle' || typeof step !== 'number' || !path) {
                  stopStatus = getStopStatus(route, s);
                } else {
                  const requiredStep = stopIndices[s.sequence] || 0;
                  // Provide a small buffer so it doesn't instantly jump at the exact frame
                  if (step >= requiredStep) {
                    stopStatus = 'delivered';
                  } else {
                    const isNext = [...(route.stops || [])]
                      .filter(x => stopIndices[x.sequence] > step)
                      .sort((a, b) => a.sequence - b.sequence)[0]?.sequence === s.sequence;
                    stopStatus = isNext ? 'current' : 'pending';
                  }
                }

                const orderData = orders.find(o => String(o.id) === String(s.order_id))

                return (
                  <Marker
                    key={`s-${route.route_id || 'unassigned'}-${routeIdx}-${s.order_id}`}
                    position={[lat, lng]}
                    icon={numberedStopIcon(
                      idx + 1, 
                      getMarkerColor(stopStatus, routeColor),
                      s.priority === 'priority'
                    )}
                  >
                    <Tooltip direction="top" offset={[0, -10]} opacity={0.9} sticky>
                      <div className="flex flex-col text-[10px] leading-tight px-1">
                        <span className="font-black text-zinc-900">#{formatId(s.order_id)}</span>
                        <span className="text-zinc-500 truncate max-w-[150px]">{orderData?.address || 'Loading...'}</span>
                      </div>
                    </Tooltip>
                    <Popup>
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                          Vehicle: {route.vehicle?.name || 'Unknown'}
                        </span>
                        <strong className="text-sm">Global Stop {globalStopCount} · Order #{formatId(s.order_id)}</strong>
                        <span className="text-[10px] uppercase font-bold text-zinc-500">
                          Status: {stopStatus}
                        </span>
                        <span className="text-xs text-zinc-600 dark:text-zinc-400">ETA: {s.eta || '—'}</span>
                      </div>
                    </Popup>
                  </Marker>
                )
              })
            })
        })()}

        {/* Active Multi-Route Rendering */}
        {[...displayedRoutes]
          .sort((a, b) => {
            const aId = a.route_id || a.id
            const bId = b.route_id || b.id
            if (activeRoute?.route_id === aId || activeRoute?.id === aId) return 1
            if (activeRoute?.route_id === bId || activeRoute?.id === bId) return -1
            return 0
          })
          .map((route) => {
          let coords = extractRouteCoordinates(route)
          
          if (route.status === 'in_progress') {
             const leg = buildLegPath(route, centers)
             if (leg.length >= 2) coords = leg
          }

          if (coords.length < 2) return null
          
          // Use original index for stable coloring
          const originalIdx = displayedRoutes.findIndex(r => (r.route_id || r.id) === (route.route_id || route.id))
          const colors = ROUTE_COLORS[originalIdx % ROUTE_COLORS.length]
          const isSelected = (activeRoute?.route_id || activeRoute?.id) === (route.route_id || route.id)

          return (
            <React.Fragment key={`multi-route-${route.route_id || route.id}`}>
              {/* Refined glow layer */}
              <Polyline
                positions={coords}
                pathOptions={{
                  color: colors.glow,
                  weight: isSelected ? 14 : 10,
                  opacity: isSelected ? 0.35 : 0.2,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
              {/* Main route line */}
              <Polyline
                positions={coords}
                eventHandlers={{
                  click: () => setActiveRouteBase(route)
                }}
                pathOptions={{
                  color: colors.primary,
                  weight: isSelected ? 6 : 5,
                  opacity: isSelected ? 1 : 0.7,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              >
                <Tooltip sticky>
                  <div className="text-xs font-bold">
                    Vehicle: {route.vehicle?.name || 'Unknown'}<br/>
                    Orders: {route.stops?.length || 0}
                  </div>
                </Tooltip>
              </Polyline>
            </React.Fragment>
          )
        })}

        {/* Background Routes (All others in the fleet) */}
        {routesList
          .filter((r) => r.status !== 'completed' && extractRouteCoordinates(r).length > 1)
          .filter((r) => {
            // Only show background routes for the selected center if one is active
            if (selectedCenterId && String(r.delivery_center?.id) !== String(selectedCenterId)) return false;
            
            // Don't double render active routes
            const isActive = activeRoute?.route_id === r.route_id
            const isMultiActive = activeMultiRoutes.some(am => am.route_id === r.route_id)
            return !isActive && !isMultiActive
          })
          .map((r) => (
            <Polyline
              key={`route-polyline-${r.route_id}`}
              positions={extractRouteCoordinates(r)}
              pathOptions={{
                color: '#94a3b8',
                weight: 3,
                opacity: 0.5,
                dashArray: '5, 10',
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          ))}

        {/* Dispatch Actions (Bottom Left Trigger) */}
        {activeRoute && (
          <button 
            onClick={() => setShowShareModal(true)}
            className="absolute bottom-4 left-4 z-1000 flex items-center gap-1.5 p-1.5 px-3 rounded-full bg-zinc-900 shadow-lg animate-in fade-in slide-in-from-left-4 duration-700 hover:bg-black hover:scale-105 transition-all group"
          >
            <Share2 className="w-3 h-3 text-white" />
            <span className="text-[9px] font-black uppercase tracking-[0.1em] text-white">
              Share
            </span>
          </button>
        )}
      </MapContainer>

      {/* Share Dispatch Modal */}
      {activeRoute && (
        <Modal
          open={showShareModal}
          onClose={() => setShowShareModal(false)}
          title="Share Route"
          className="max-w-sm"
        >
          <div className="space-y-3 py-1">
            <div className="flex items-center gap-3 p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
                <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 shrink-0">
                  <MapIcon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-zinc-900 dark:text-white truncate">Google Maps</p>
                  <p className="text-[9px] text-zinc-500 truncate">Full navigation sequence</p>
                </div>
                <button 
                  onClick={handleOpenMaps}
                  className="px-2.5 py-1.5 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-lg text-[10px] font-bold hover:opacity-90 transition-opacity"
                >
                  Open
                </button>
            </div>

            <div className="flex items-center gap-3 p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
                <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 shrink-0">
                  <MessageSquare className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-zinc-900 dark:text-white truncate">WhatsApp</p>
                  <p className="text-[9px] text-zinc-500 truncate">Send to driver</p>
                </div>
                <button 
                  onClick={handleSendWhatsApp}
                  className="px-2.5 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-bold hover:bg-emerald-700 transition-colors"
                >
                  Send
                </button>
            </div>

            <div className="flex items-center gap-3 p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
                <div className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-600 shrink-0">
                  <Copy className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-zinc-900 dark:text-white truncate">Copy Link</p>
                  <p className="text-[9px] text-zinc-500 truncate">To clipboard</p>
                </div>
                <button 
                  onClick={handleCopyLink}
                  className="px-2.5 py-1.5 bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 rounded-lg text-[10px] font-bold hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
                >
                  Copy
                </button>
            </div>

            {activeRoute.stops?.length > 10 && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-2.5 rounded-lg border border-amber-100 dark:border-amber-900/30 font-medium leading-relaxed">
                Note: Route exceeds 10 stops. Only the first 10 stops are included in the navigation link.
              </p>
            )}
          </div>
        </Modal>
      )}

      {/* Floating Simulation Controls */}
      {(activeRoute || activeMultiRoutes?.length > 0) && (
        <div className="absolute bottom-4 right-4 z-1000 flex items-center gap-2">
          {simulationPhase === 'idle' || simulationPhase === 'completed' ? (
            <button
              onClick={() => startFleetSimulation()}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white shadow-xl hover:bg-emerald-700 transition-all active:scale-95"
            >
              <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                <path d="M4.5 3.5v13L16.5 10 4.5 3.5z" />
              </svg>
              Simulate
            </button>
          ) : (
            <div className="flex items-center gap-1 bg-white/90 dark:bg-zinc-900/90 p-1 rounded-lg border border-zinc-200 dark:border-zinc-800 shadow-xl backdrop-blur-sm">
              {simulationPhase === 'running' ? (
                <button
                  onClick={() => pauseFleetSimulation()}
                  className="p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors"
                  title="Pause"
                >
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                  </svg>
                </button>
              ) : (
                <button
                  onClick={() => resumeFleetSimulation()}
                  className="p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-emerald-600 transition-colors"
                  title="Resume"
                >
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
              )}
              <button
                onClick={() => resetFleetSimulation()}
                className="p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-red-500 transition-colors"
                title="Reset"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
