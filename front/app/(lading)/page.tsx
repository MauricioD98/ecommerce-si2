import { Suspense } from "react";
import Footer from "@/components/modules/landing/Footer";
import Header from "@/components/modules/landing/Header";
import ProductList from "@/components/modules/landing/ProductList";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function Home() {
  return <>
    <Header />
    <main style={{ minHeight: "60vh" }}>
      {/* ProductList y ProductFilters leen useSearchParams: Next.js exige un límite Suspense */}
      <Suspense fallback={null}>
        <ProductList />
      </Suspense>
    </main>
    <Footer />

  </>;
}
