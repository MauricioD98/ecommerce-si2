'use client';

import React, { useState } from 'react';
import Script from 'next/script';

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

export default function BotpressChat() {
    const [isInjectReady, setIsInjectReady] = useState(false);

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
