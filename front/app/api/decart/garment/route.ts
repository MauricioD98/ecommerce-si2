import { NextRequest, NextResponse } from 'next/server';

// Proxy de la imagen de la prenda. El SDK de Decart necesita los bytes (Blob) de la referencia, y
// las imágenes del catálogo vienen de hosts arbitrarios (ver images.remotePatterns en next.config):
// un fetch directo desde el navegador depende de que ese host manda Access-Control-Allow-Origin.
// Pasando por acá siempre es same-origin y nunca hay CORS.

export const runtime = 'nodejs';

const MAX_BYTES = 8 * 1024 * 1024;

// El destino lo elige el cliente, así que hay que evitar que esto sea un SSRF hacia la red interna.
const isPubliclyRoutable = (hostname: string): boolean => {
    const host = hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return false;
    if (host === '[::1]' || host === '::1') return false;
    // IPv4 privada / loopback / link-local / metadata de la nube
    if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (/^169\.254\./.test(host) || /^0\./.test(host)) return false;
    return true;
};

export async function GET(request: NextRequest) {
    const target = request.nextUrl.searchParams.get('url');
    if (!target) {
        return NextResponse.json({ message: 'Falta el parámetro url.' }, { status: 400 });
    }

    let parsed: URL;
    try {
        parsed = new URL(target);
    } catch {
        return NextResponse.json({ message: 'URL de imagen inválida.' }, { status: 400 });
    }

    if (!['http:', 'https:'].includes(parsed.protocol) || !isPubliclyRoutable(parsed.hostname)) {
        return NextResponse.json({ message: 'URL de imagen no permitida.' }, { status: 400 });
    }

    try {
        const upstream = await fetch(parsed.toString(), {
            headers: { Accept: 'image/*' },
            signal: AbortSignal.timeout(10000),
        });

        const contentType = upstream.headers.get('content-type') ?? '';
        if (!upstream.ok || !contentType.startsWith('image/')) {
            return NextResponse.json({ message: 'No se pudo descargar la imagen de la prenda.' }, { status: 502 });
        }

        const bytes = await upstream.arrayBuffer();
        if (bytes.byteLength > MAX_BYTES) {
            return NextResponse.json({ message: 'La imagen de la prenda es demasiado grande.' }, { status: 413 });
        }

        return new NextResponse(bytes, {
            headers: {
                'Content-Type': contentType,
                'Content-Length': String(bytes.byteLength),
                'Cache-Control': 'public, max-age=3600',
            },
        });
    } catch (error) {
        console.error('[decart] fallo el proxy de la imagen de la prenda', error);
        return NextResponse.json({ message: 'No se pudo descargar la imagen de la prenda.' }, { status: 502 });
    }
}
