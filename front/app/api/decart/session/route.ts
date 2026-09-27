import { NextRequest, NextResponse } from 'next/server';
import { createDecartClient } from '@decartai/sdk';

// Firma la sesión del Probador Virtual. La API key permanente (dct_...) vive SOLO acá: al navegador
// se le entrega un token efímero (ek_...) acotado a un modelo, a este origen y a una duración máxima.
// Decart cobra por segundo generado, así que el token trae su propio techo: si el cliente ignora el
// setTimeout de 15s (o lo parchean desde devtools), el servidor corta igual a los MAX_SESSION_SECONDS.

export const runtime = 'nodejs';

const MODEL = 'lucy-vton-latest';
// 15s de transmisión que muestra la UI + margen para el handshake de WebRTC. El mínimo que acepta
// Decart es 10s.
const MAX_SESSION_SECONDS = 25;
// TTL del token: solo necesita vivir lo que tarda el navegador en conectar. Expirar no corta una
// sesión ya activa, únicamente impide abrir nuevas.
const TOKEN_TTL_SECONDS = 60;

const getApiBaseUrl = (): string => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

// Cada sesión cuesta dinero real, así que no se firma para anónimos: se revalida el access token
// contra el backend de Nest antes de gastar.
const isAuthenticated = async (authorization: string | null): Promise<boolean> => {
    if (!authorization?.startsWith('Bearer ')) return false;
    try {
        const response = await fetch(`${getApiBaseUrl()}/users/me`, {
            headers: { Authorization: authorization },
            cache: 'no-store',
        });
        return response.ok;
    } catch {
        return false;
    }
};

export async function POST(request: NextRequest) {
    const apiKey = process.env.DECART_API_KEY;
    if (!apiKey) {
        return NextResponse.json({ message: 'Falta DECART_API_KEY en el servidor.' }, { status: 500 });
    }

    if (!(await isAuthenticated(request.headers.get('authorization')))) {
        return NextResponse.json({ message: 'Inicia sesión para usar el probador virtual.' }, { status: 401 });
    }

    // allowedOrigins compara el header Origin tal cual. En http://localhost el navegador lo manda
    // igual, así que sirve en dev y en producción; si no llega, se firma sin restricción de origen.
    const origin = request.headers.get('origin');

    try {
        const client = createDecartClient({ apiKey });
        const token = await client.tokens.create({
            expiresIn: TOKEN_TTL_SECONDS,
            allowedModels: [MODEL],
            ...(origin ? { allowedOrigins: [origin] } : {}),
            constraints: { realtime: { maxSessionDuration: MAX_SESSION_SECONDS } },
        });

        return NextResponse.json(
            { apiKey: token.apiKey, expiresAt: token.expiresAt, model: MODEL },
            { headers: { 'Cache-Control': 'no-store' } },
        );
    } catch (error) {
        console.error('[decart] no se pudo crear el token de sesión', error);
        return NextResponse.json({ message: 'No se pudo iniciar la sesión del probador virtual.' }, { status: 502 });
    }
}
