import { useRef, useState } from "react";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Button } from "@crate/ui/shadcn/button";

function ShellExample({ app }: { app: "Admin" | "Listen" }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  return (
    <figure className="m-0 min-w-0">
      <figcaption className="crate-form-field mb-4">
        <MonoLabel>{app} · enlace real compartido</MonoLabel>
        <Button
          variant="outline"
          disabled={!ready}
          onClick={() =>
            frame.current?.contentDocument
              ?.querySelector<HTMLAnchorElement>(".crate-skip-link")
              ?.focus()
          }
        >
          Mostrar enlace de {app}
        </Button>
      </figcaption>
      <iframe
        ref={frame}
        onLoad={() =>
          setReady(
            Boolean(
              frame.current?.contentDocument?.querySelector(".crate-skip-link"),
            ),
          )
        }
        title={`Ejemplo de teclado de ${app}`}
        src={`./skip-link-demo.html?app=${app.toLowerCase()}&locale=es&tab=albums#origen`}
        className="skip-link-example"
      />
    </figure>
  );
}
export function SkipLinkCheckpoint() {
  return (
    <section
      id="saltar-contenido"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1U, Saltar al contenido"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="22">
            Checkpoint 1U · Publicado
          </MonoLabel>
          <h2>El contenido, primero.</h2>
        </div>
        <p>
          Un enlace al comenzar con el teclado. El foco salta la navegación y
          continúa dentro del contenido.
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-8">
        <ShellExample app="Admin" />
        <ShellExample app="Listen" />
      </div>
      <p className="mt-6 text-sm text-text-muted">
        Pulsa Tab dentro de cada ejemplo, o usa Mostrar enlace. Enter salta al
        contenido; Tab continúa con Abrir muestra. Al perder el foco, el enlace
        se oculta.
      </p>
      <p className="mt-4 text-sm text-text-muted">
        Componente compartido real en documentos aislados. Navegación y datos
        ficticios, sin API ni preferencias guardadas. La integración de los
        Shell de ambas apps se comprueba por separado.
      </p>
    </section>
  );
}
