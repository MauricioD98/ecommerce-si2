import { renderStoreIcon } from "../iconImage";

export async function GET(request: Request, { params }: { params: Promise<{ size: string }> }) {
    const { size } = await params;
    return renderStoreIcon(request, size, false);
}
