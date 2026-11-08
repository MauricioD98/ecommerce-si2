'use client';

import React, { useEffect, useState } from 'react';
import Script from 'next/script';
import { usePathname } from 'next/navigation';

// Widget de chat de Botpress. Son dos scripts con una dependencia estricta: el segundo es
// literalmente una llamada a `window.botpress.init({...})`, así que si corre antes de que inject.js
// haya definido `window.botpress` tira "cannot read properties of undefined" y no aparece la burbuja.
//
// Por eso el segundo no se monta hasta el onLoad del primero, en vez de confiar en el orden: dos
// <Script> con la misma strategy se inyectan en paralelo y next/script no garantiza el orden de
// ejecución entre ellos (el `defer` del snippet original solo ordena scripts del HTML inicial, no
// los que se agregan desde el cliente).
//
// afterInteractive: el chat no hace falta para pintar la página, y son ~1 MB de inject.js que no
// deben competir con el primer render del catálogo.

const INJECT_SRC = 'https://cdn.botpress.cloud/webchat/v3.7/inject.js';
const BOT_CONFIG_SRC = 'https://files.bpcontent.cloud/2026/09/27/14/20260927140956-AYRZZAV5.js';

// Rutas sin chat: todo el checkout (entrega, pago, confirmación, borradores y las pantallas de resultado a
// las que vuelve Stripe, /checkout/success...), el perfil del cliente, los paneles de la tienda y del SaaS, y
// las pantallas de acceso (login, registro, recuperar y restablecer contraseña).
const HIDDEN_PREFIXES = ['/checkout', '/account', '/admin', '/plataforma', '/auth'];

export const isChatHiddenPath = (pathname: string | null): boolean =>
    !!pathname && HIDDEN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

type BotpressApi = { close?: () => void };

export default function BotpressChat() {
    const [isInjectReady, setIsInjectReady] = useState(false);
    const hidden = isChatHiddenPath(usePathname());

    // El atributo en <html> lo lee globals.css para ocultar el contenedor del widget (botón, ventana y
    // vista previa). Se usa CSS y no se desmonta el widget: así cubre también el caso en que Botpress
    // termina de cargar después de entrar a la ruta, y al volver al catálogo el botón reaparece solo.
    useEffect(() => {
        const root = document.documentElement;
        if (!hidden) {
            root.removeAttribute('data-chat-hidden');
            return;
        }
        root.setAttribute('data-chat-hidden', '');
        // Si la ventana estaba abierta se cierra: al volver al catálogo aparece solo el botón
        try {
            (window as unknown as { botpress?: BotpressApi }).botpress?.close?.();
        } catch {
            // Widget todavía sin inicializar: no hay ventana abierta que cerrar
        }
    }, [hidden]);

    return (
        <>
            <Script
                src={INJECT_SRC}
                strategy="afterInteractive"
                onLoad={() => setIsInjectReady(true)}
                onError={() => console.error('[botpress] no se pudo cargar inject.js')}
            />
            {isInjectReady && (
                <Script
                    src={BOT_CONFIG_SRC}
                    strategy="afterInteractive"
                    onError={() => console.error('[botpress] no se pudo cargar la configuración del bot')}
                />
            )}
        </>
    );
}
