import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { Footer } from "@/components/Footer";
import { Manifesto } from "@/components/Manifesto";

export default function App() {
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
  const isManifesto = pathname === "/why";

  return (
    <div className="grain relative min-h-screen">
      <Nav />
      <main>{isManifesto ? <Manifesto /> : <Hero />}</main>
      <Footer />
    </div>
  );
}
