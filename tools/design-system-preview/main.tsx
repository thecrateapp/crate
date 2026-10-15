import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import "./style.css";

function App() {
  const [motion, setMotion] = useState(true);
  const [above, setAbove] = useState(false);
  function toggleMotion() {
    const next = !motion;
    document.documentElement.dataset.crateMotion = next ? "full" : "reduced";
    setMotion(next);
  }
  return (
    <main>
      <header className="masthead">
        <a className="brand" href="#top" aria-label="Crate, inicio">
          crate<span className="version">v3</span>
        </a>
        <MonoLabel
          meta={["Checkpoint 1A", "Vista local"]}
          className="masthead-meta"
        />
        <a className="jump" href="#primitivas">
          Ver primitivas <span aria-hidden="true">↘</span>
        </a>
      </header>
      <section id="top" className="intro">
        <MonoLabel
          size="eyebrow"
          accent="01"
          meta={["Tu colección", "Sin límites"]}
        />
        <h1>
          El ritmo de
          <br />
          tu biblioteca.
        </h1>
        <p>Toda tu música. Cada detalle en su sitio.</p>
      </section>
      <section
        className="library"
        aria-label="Ejemplo de biblioteca con datos ficticios"
      >
        <div className="collection">
          <div className="section-top">
            <MonoLabel as="h2" accent="/" meta={["La colección"]} />
            <StatusDot tone="on" label="Al día" />
          </div>
          <div className="big-stat">
            <StatNumber
              size="xl"
              value="48.216"
              label="Canciones en tu biblioteca"
            />
          </div>
          <div className="secondary-stats">
            <StatNumber value="4.400" label="Álbumes" size="md" />
            <StatNumber value="900" label="Artistas" size="md" />
            <StatNumber
              value="1,2"
              unit="TB"
              label="Música guardada"
              size="md"
            />
          </div>
        </div>
        <aside className="services">
          <MonoLabel as="h2" accent="/">
            Ahora mismo
          </MonoLabel>
          <div className="service">
            <div>
              <h3>Biblioteca</h3>
              <p>Todo listo para escuchar</p>
            </div>
            <StatusDot tone="on" label="Activa" />
          </div>
          <div className="service">
            <div>
              <h3>Análisis de audio</h3>
              <p>Preparando tu colección</p>
            </div>
            <StatusDot tone="on" pulse label="En curso" />
          </div>
          <div className="service">
            <div>
              <h3>Enriquecimiento</h3>
              <p>Requiere tu atención</p>
            </div>
            <StatusDot tone="warn" label="Pendiente" />
          </div>
          <div className="service">
            <div>
              <h3>Adquisición</h3>
              <p>Sin tareas pendientes</p>
            </div>
            <StatusDot tone="off" label="En pausa" />
          </div>
          <MonoLabel className="sample-note">Datos de ejemplo</MonoLabel>
        </aside>
      </section>
      <section id="primitivas" className="specimens">
        <div className="specimen-heading">
          <div>
            <MonoLabel size="eyebrow" accent="02">
              Las piezas, de cerca
            </MonoLabel>
            <h2>
              Pequeños detalles.
              <br className="mobile-break" /> Una misma voz.
            </h2>
          </div>
          <span className="count">3 primitivas</span>
        </div>
        <div className="specimen-grid">
          <article className="specimen">
            <div className="specimen-title">
              <MonoLabel as="h3" accent="01">
                MonoLabel
              </MonoLabel>
              <span>Jerarquía</span>
            </div>
            <div className="label-examples">
              <div>
                <span className="hint">ETIQUETA</span>
                <MonoLabel>Tu biblioteca</MonoLabel>
              </div>
              <div>
                <span className="hint">EYEBROW</span>
                <MonoLabel size="eyebrow" accent="/">
                  Descubre más
                </MonoLabel>
              </div>
              <div>
                <span className="hint">METADATOS</span>
                <MonoLabel meta={["Radiohead", "1997", "12 canciones"]} />
              </div>
            </div>
            <p className="explanation">
              La misma cadencia para secciones, índices y metadatos.
            </p>
          </article>
          <article className="specimen">
            <div className="specimen-title">
              <MonoLabel as="h3" accent="02">
                StatusDot
              </MonoLabel>
              <span>Estado</span>
            </div>
            <div className="dot-examples">
              <StatusDot tone="on" label="Disponible" />
              <StatusDot tone="warn" label="Necesita atención" />
              <StatusDot tone="off" label="Desactivado" />
              <StatusDot tone="on" pulse label="Procesando" />
            </div>
            <button
              className="control"
              type="button"
              aria-pressed={!motion}
              onClick={toggleMotion}
            >
              {motion ? "Pausar movimiento" : "Activar movimiento"}
              <span aria-hidden="true">{motion ? "Ⅱ" : "▷"}</span>
            </button>
          </article>
          <article className="specimen numeral-specimen">
            <div className="specimen-title">
              <MonoLabel as="h3" accent="03">
                StatNumber
              </MonoLabel>
              <span>Lectura</span>
            </div>
            <div className="inline-stat">
              <StatNumber
                size="lg"
                value="96"
                unit="kHz"
                label="Frecuencia de muestreo"
                labelPosition={above ? "above" : "below"}
              />
            </div>
            <button
              className="control"
              type="button"
              aria-pressed={above}
              onClick={() => setAbove(!above)}
            >
              Etiqueta {above ? "debajo" : "encima"}
              <span aria-hidden="true">↕</span>
            </button>
          </article>
        </div>
        <div className="scale">
          <div className="scale-intro">
            <MonoLabel accent="/">Escala numérica</MonoLabel>
            <p>
              Del detalle
              <br />
              al protagonista.
            </p>
          </div>
          <div className="scale-item">
            <StatNumber size="sm" value="128" unit="kbps" label="sm" />
          </div>
          <div className="scale-item">
            <StatNumber size="md" value="24" unit="bit" label="md" />
          </div>
          <div className="scale-item">
            <StatNumber size="lg" value="96" unit="kHz" label="lg" />
          </div>
          <div className="scale-item">
            <StatNumber size="xl" value="48" unit="kHz" label="xl" />
          </div>
        </div>
      </section>
      <footer>
        <MonoLabel meta={["Crate V3", "MonoLabel · StatusDot · StatNumber"]} />
        <p>Mockup de revisión · componentes reales · datos ficticios</p>
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
