import { redirect } from 'next/navigation';

// El flujo ahora es por código (OTP) y vive completo en /auth/forgot-password.
// Se mantiene esta ruta solo para que los enlaces antiguos de los correos no den 404.
export default function page() {
    redirect('/auth/forgot-password');
}
