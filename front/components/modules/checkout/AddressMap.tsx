'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
        // map.stop() corta cualquier flyTo en curso: si el padre desmonta el mapa (p. ej. al
        // guardar y cerrar el modal) mientras la animación todavía corre, el próximo frame de esa
        // animación intenta reposicionar panes que React ya sacó del DOM -> "_leaflet_pos" de undefined.
        // try/catch a propósito: si el desmontaje ya dejó al pan-animation interno de Leaflet
        // (this._panAnim) apuntando a un pane sin DOM, stop() puede reventar adentro de Leaflet
        // mismo, no acá. Un guard de "¿existe el contenedor?" no lo cubre porque esa referencia
        // interna está un nivel más abajo que el contenedor del mapa. Igual vale la pena intentarlo:
        // en el caso normal (sin race) sí corta la animación a tiempo.
        return () => {
            try {
                map.stop();
            } catch {
                // Ya se estaba desmontando en medio de la animación; no hay nada que limpiar.
            }
        };
        // Solo se centra cuando cambia focusKey, no al arrastrar el marcador
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focusKey, map]);
    return null;
}

// Si el mapa se desmonta con un drag de marcador en curso (el usuario suelta justo cuando se
// dispara "Guardar"), el Draggable interno de Leaflet sigue con listeners de mousemove/mouseup
// pegados a `document`. React ya removió el ícono del DOM, pero esos listeners siguen vivos y el
// próximo evento intenta leer `_icon._leaflet_pos` -> undefined. Desactivar el drag en el cleanup
// (antes de que React desmonte) saca esos listeners a tiempo.
function useSafeMarkerUnmount(markerRef: React.RefObject<L.Marker | null>) {
    useEffect(() => {
        return () => {
            markerRef.current?.dragging?.disable();
        };
    }, [markerRef]);
}

interface AddressMapProps {
    position: MapPosition;
    onPositionChange: (position: MapPosition) => void;
    focusKey: number;
}

export default function AddressMap({ position, onPositionChange, focusKey }: AddressMapProps) {
    const markerRef = useRef<L.Marker>(null);
    useSafeMarkerUnmount(markerRef);

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

    // dynamic(..., { ssr: false }) en los padres ya garantiza que esto solo se evalúa en cliente;
    // esta guarda es una segunda red de seguridad por si este componente llegara a importarse desde
    // algún lugar sin ese wrapper en el futuro. Leaflet toca `window`/`document` en el import de
    // nivel de módulo, así que renderizar en el servidor rompe con un TypeError distinto (no el de
    // "_leaflet_pos", pero igual de fatal).
    const [isMounted, setIsMounted] = useState(false);
    useEffect(() => setIsMounted(true), []);
    if (!isMounted || !position) return null;

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
