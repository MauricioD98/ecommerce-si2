import { AtSign, Camera, CirclePlay, Globe, LucideIcon, MessageCircle, Music2, ThumbsUp } from "lucide-react";
import type { SocialPlatform } from "@/types/appearance.types";

// lucide-react 1.x ya no trae logos de marcas: se usa un ícono genérico reconocible por red.
// Compartido por el panel (formulario y vista previa) y el footer de la tienda.
export const SOCIAL_ICONS: Record<SocialPlatform, LucideIcon> = {
    instagram: Camera,
    facebook: ThumbsUp,
    tiktok: Music2,
    whatsapp: MessageCircle,
    x: AtSign,
    youtube: CirclePlay,
    website: Globe,
};

// Placeholder del input de URL según la red elegida
export const SOCIAL_PLACEHOLDERS: Record<SocialPlatform, string> = {
    instagram: "https://instagram.com/mitienda",
    facebook: "https://facebook.com/mitienda",
    tiktok: "https://tiktok.com/@mitienda",
    whatsapp: "https://wa.me/59170000000",
    x: "https://x.com/mitienda",
    youtube: "https://youtube.com/@mitienda",
    website: "https://mitienda.com",
};
