'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { MapPosition, SANTA_CRUZ_CENTER } from '@/types/address.types';

// Los íconos por defecto de Leaflet se rompen con los bundlers (Turbopack): se sirven desde el CDN público
const pinIcon = L.icon({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
});

// Un clic en el mapa también mueve el marcador
function ClickToMove({ onChange }: { onChange: (position: MapPosition) => void }) {
    useMapEvents({
        click(event) {
            onChange({ lat: event.latlng.lat, lng: event.latlng.lng });
        },
    });
    return null;
}

// Centra el mapa cuando cambia focusKey (p. ej. al usar "Mi ubicación")
function FocusOnChange({ position, focusKey }: { position: MapPosition; focusKey: number }) {
    const map = useMap();
    useEffect(() => {
        if (focusKey > 0) {
            map.flyTo([position.lat, position.lng], 16);
        }
        // Solo se centra cuando cambia focusKey, no al arrastrar el marcador
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focusKey, map]);
    return null;
}

interface AddressMapProps {
    position: MapPosition;
    onPositionChange: (position: MapPosition) => void;
    focusKey: number;
}

export default function AddressMap({ position, onPositionChange, focusKey }: AddressMapProps) {
    const markerRef = useRef<L.Marker>(null);

    // Al soltar el marcador se captura la latitud y la longitud
    const eventHandlers = useMemo(
        () => ({
            dragend() {
                const marker = markerRef.current;
                if (marker) {
                    const { lat, lng } = marker.getLatLng();
                    onPositionChange({ lat, lng });
                }
            },
        }),
        [onPositionChange]
    );

    return (
        <MapContainer
            center={[SANTA_CRUZ_CENTER.lat, SANTA_CRUZ_CENTER.lng]}
            zoom={13}
            scrollWheelZoom
            style={{ height: '100%', width: '100%' }}
        >
            <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <Marker
                draggable
                position={[position.lat, position.lng]}
                icon={pinIcon}
                ref={markerRef}
                eventHandlers={eventHandlers}
            />
            <ClickToMove onChange={onPositionChange} />
            <FocusOnChange position={position} focusKey={focusKey} />
        </MapContainer>
    );
}
