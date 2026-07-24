<?php

namespace App\Http\Requests;

use App\Enums\OrderPriority;
use App\Enums\OrderStatus;
use App\Models\Order;
use App\Models\Vehicle;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Enum;

class UpdateOrderRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'status' => ['sometimes', 'required', new Enum(OrderStatus::class)],
            'priority' => ['sometimes', new Enum(OrderPriority::class)],
            'vehicle_id' => ['sometimes', 'nullable', 'string'],
        ];
    }

    public function withValidator($validator): void
    {
        $validator->after(function ($validator) {
            $vehicleId = $this->input('vehicle_id');
            if (!$vehicleId) return;

            $orderId = $this->route('id');
            $order = Order::find($orderId);
            if (!$order) return;

            $vehicle = Vehicle::find($vehicleId);
            if (!$vehicle) {
                $validator->errors()->add('vehicle_id', 'Vehicle not found.');
                return;
            }

            if ((string) $vehicle->delivery_center_id !== (string) $order->delivery_center_id) {
                $validator->errors()->add(
                    'vehicle_id',
                    'This vehicle does not belong to the order\'s delivery center.'
                );
            }
        });
    }
}
