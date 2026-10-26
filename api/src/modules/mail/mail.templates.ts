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

// brand/footer: los correos de la plataforma SaaS (alta de tienda, contacto) no van con la marca
// de una tienda ni dicen "tienes una cuenta en STELLA FEMME".
export const layout = (
  title: string,
  content: string,
  { brand = 'STELLA FEMME', footer = 'Recibiste este correo porque tienes una cuenta en STELLA FEMME.' } = {},
): string => `<!DOCTYPE html>
<html lang="es">
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f5f5;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;">
        <tr><td style="background:#000;color:#fff;padding:20px 32px;font-size:20px;font-weight:800;letter-spacing:-0.02em;">${escapeHtml(brand)}</td></tr>
        <tr><td style="padding:32px;font-size:15px;line-height:1.6;">
          <h1 style="margin:0 0 16px;font-size:22px;color:#000;">${escapeHtml(title)}</h1>
          ${content}
        </td></tr>
        <tr><td style="padding:16px 32px;background:#fafafa;color:#6b7280;font-size:12px;">
          ${escapeHtml(footer)}
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

const platformBrand = () => process.env.PLATFORM_NAME || 'Stella Commerce';

// Al dueño de una tienda recién creada por el alta self-service (webhook checkout.session.completed)
export const tenantWelcomeEmail = (params: {
  tenantName: string;
  loginUrl: string;
  adminEmail: string;
  domain?: string | null;
  platformHost: string;
}) =>
  layout(
    `¡${params.tenantName} ya está en línea!`,
    `<p>Recibimos tu pago y tu tienda está lista. Entra al panel con tu correo <strong>${escapeHtml(params.adminEmail)}</strong> y la contraseña que elegiste al registrarte.</p>
     ${button('Entrar al panel de mi tienda', params.loginUrl)}
     <p>Primeros pasos recomendados: crea tus sucursales, carga tus productos y conecta tu cuenta de cobros para recibir pagos con tarjeta.</p>
     ${
       params.domain
         ? `<p><strong>Tu dominio ${escapeHtml(params.domain)}:</strong> crea un registro <code>CNAME</code> que apunte a <code>${escapeHtml(params.platformHost)}</code>. Lo activamos apenas verifiquemos el DNS; mientras tanto, tu tienda funciona con el enlace de arriba.</p>`
         : ''
     }`,
    { brand: platformBrand(), footer: `Recibiste este correo porque creaste una tienda en ${platformBrand()}.` },
  );

// Formulario de contacto de la landing → bandeja de soporte. Todo lo del visitante va escapado:
// es texto libre de alguien anónimo y termina renderizado en el cliente de correo del equipo.
export const contactEmail = (params: { name: string; email: string; message: string; ip?: string }) =>
  layout(
    'Nuevo mensaje desde el formulario de contacto',
    `<p><strong>Nombre:</strong> ${escapeHtml(params.name)}<br/>
        <strong>Email:</strong> ${escapeHtml(params.email)}${params.ip ? `<br/><strong>IP:</strong> ${escapeHtml(params.ip)}` : ''}</p>
     <div style="white-space:pre-wrap;border-left:3px solid #e5e7eb;padding-left:12px;">${escapeHtml(params.message)}</div>
     <p style="color:#6b7280;font-size:13px;">Responder a este correo le escribe directamente al remitente.</p>`,
    { brand: platformBrand(), footer: 'Mensaje enviado desde la landing de la plataforma.' },
  );
