// Plantillas HTML de los correos. Se arman en TypeScript (con estilos en línea, que es lo que
// entienden los clientes de correo) para no depender de un motor de plantillas.

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// El HTML de las campañas lo escribe un administrador: se quitan scripts, iframes, manejadores de eventos
// (onclick=...) y enlaces javascript: antes de enviarlo a los clientes.
export const sanitizeCampaignHtml = (html: string): string =>
  html
    .replace(/<\s*(script|iframe|object|embed)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|iframe|object|embed)[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1=$2#$2');

const button = (label: string, url: string): string =>
  `<p style="margin:24px 0;"><a href="${escapeHtml(url)}" style="background:#000;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">${escapeHtml(label)}</a></p>`;

export const layout = (title: string, content: string): string => `<!DOCTYPE html>
<html lang="es">
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f5f5;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;">
        <tr><td style="background:#000;color:#fff;padding:20px 32px;font-size:20px;font-weight:800;letter-spacing:-0.02em;">STELLA FEMME</td></tr>
        <tr><td style="padding:32px;font-size:15px;line-height:1.6;">
          <h1 style="margin:0 0 16px;font-size:22px;color:#000;">${escapeHtml(title)}</h1>
          ${content}
        </td></tr>
        <tr><td style="padding:16px 32px;background:#fafafa;color:#6b7280;font-size:12px;">
          Recibiste este correo porque tienes una cuenta en STELLA FEMME.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

export const welcomeEmail = (name: string, storeUrl: string) =>
  layout(
    `¡Bienvenido, ${name}!`,
    `<p>Tu cuenta en STELLA FEMME ya está lista. Explora el catálogo, elige tu sucursal y compra con retiro en tienda o envío a domicilio.</p>${button('Ir a la tienda', storeUrl)}`,
  );

export const resetPasswordEmail = (name: string, otp: string) =>
  layout(
    'Tu código de recuperación',
    `<p>Hola ${escapeHtml(name)}, usa este código para restablecer tu contraseña:</p>
     <p style="text-align:center;margin:24px 0;font-size:36px;font-weight:800;letter-spacing:0.4em;padding-left:0.4em;">${escapeHtml(otp)}</p>
     <p style="color:#6b7280;font-size:13px;">El código vence en 10 minutos. Si no fuiste tú, ignora este correo: tu contraseña no cambiará.</p>`,
  );

export const invoiceEmail = (name: string, orderNumber: string, total: string) =>
  layout(
    'Gracias por tu compra',
    `<p>Hola ${escapeHtml(name)}, recibimos el pago de tu pedido <strong>#${escapeHtml(orderNumber)}</strong> por <strong>${escapeHtml(total)}</strong>.</p>
     <p>Adjuntamos tu factura en PDF.</p>`,
  );

export const campaignEmail = (subject: string, htmlBody: string) => layout(subject, sanitizeCampaignHtml(htmlBody));
