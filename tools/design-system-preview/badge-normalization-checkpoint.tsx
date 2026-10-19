import { useState } from "react";
import { InfoBadge, type InfoBadgeTone } from "@crate/ui/primitives/InfoBadge";
import { FilterChip } from "@crate/ui/primitives/FilterChip";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { GenrePill } from "@crate/ui/domain/genres/GenrePill";
import { OfflineBadge } from "@crate/ui/domain/offline/OfflineBadge";
import { Badge } from "@crate/ui/shadcn/badge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { QualityBadge } from "../../app/listen/src/components/player/bar/QualityBadge";

const tones: [InfoBadgeTone, string][] = [
  ["neutral", "Sin actividad"],
  ["info", "Procesando"],
  ["success", "Listo"],
  ["warning", "Revisar"],
  ["danger", "Error"],
  ["accent", "Seleccionado"],
];
export function BadgeNormalizationCheckpoint() {
  const [active, setActive] = useState(false);
  const [scope, setScope] = useState("all");
  const [feedback, setFeedback] = useState("Sin acciones");
  return (
    <section
      id="badges-compartidos"
      aria-label="Checkpoint 1AQ, etiquetas compartidas"
      className="admin-baseline-feature"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="42">
            Checkpoint 1AQ · En revisión
          </MonoLabel>
          <h2>Información que se lee.</h2>
        </div>
        <p>
          Una colección compartida en @crate/ui. Cada componente conserva su
          función.
        </p>
      </div>
      <div className="mt-8 grid min-w-0 grid-cols-1 gap-8">
        <article aria-label="InfoBadge">
          <h3 className="font-display text-xl">InfoBadge · información</h3>
          <p className="mt-2 text-sm text-text-secondary">
            24 px de alto · JetBrains Mono 12/16 · borde de 1 px · padding de 3
            × 8 px
          </p>
          <div className="mt-4 flex min-w-0 flex-wrap gap-2">
            {tones.map(([tone, label]) => (
              <InfoBadge key={tone} tone={tone}>
                {label}
              </InfoBadge>
            ))}
            <InfoBadge variant="counter">3</InfoBadge>
            <InfoBadge>1.248 pistas</InfoBadge>
            <InfoBadge>
              Metadato de longitud excepcional para comprobar el espacio
              disponible en móvil
            </InfoBadge>
          </div>
        </article>
        <article aria-label="Consumidores reales">
          <h3 className="font-display text-xl">
            La misma base en Admin y Listen
          </h3>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Library Health · 3</Badge>
            <InfoBadge>system</InfoBadge>
            <InfoBadge>12 tracks</InfoBadge>
            <QualityBadge
              badge={{
                tier: "lossless",
                label: "Lossless",
                detail: "FLAC · 24-bit / 96 kHz",
              }}
            />
            <OfflineBadge state="error" />
            <OfflineBadge state="ready" compact />
            <OfflineBadge state="error" compact />
          </div>
          <p className="mt-2 text-sm text-text-secondary">
            Badge de Admin, calidad de reproducción y disponibilidad offline de
            Listen, con sus componentes reales.
          </p>
        </article>
        <article id="calidad-badges" aria-label="QualityBadge">
          <h3 className="font-display text-xl">
            QualityBadge · calidad de audio
          </h3>
          <p className="mt-2 text-sm text-text-secondary">
            El componente real de Listen usa InfoBadge. Conserva el nivel, el
            glifo, el detalle y el significado del color.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <QualityBadge
              badge={{
                tier: "hi-res",
                label: "HI-RES",
                detail: "24-bit / 96 kHz",
              }}
            />
            <QualityBadge
              badge={{
                tier: "lossless",
                label: "Lossless",
                detail: "FLAC · 16-bit / 44.1 kHz",
              }}
            />
            <QualityBadge
              badge={{ tier: "high", label: "High", detail: "AAC · 256 kbps" }}
            />
            <QualityBadge
              badge={{ tier: "standard", label: "MP3", detail: "320 kbps" }}
            />
            <QualityBadge
              badge={{ tier: "low", label: "Low", detail: "MP3 · 96 kbps" }}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-text-secondary">Streaming:</span>
            <QualityBadge
              origin="stream"
              badge={{
                tier: "lossless",
                label: "Lossless",
                detail: "FLAC · original delivery",
              }}
            />
            <QualityBadge
              origin="stream"
              badge={{ tier: "high", label: "High", detail: "AAC · 256 kbps" }}
            />
          </div>
        </article>
        <article aria-label="FilterChip">
          <h3 className="font-display text-xl">FilterChip · filtros</h3>
          <p className="mt-2 text-sm text-text-secondary">
            Texto de 12 px · mínimo 32 px con ratón / 44 px táctil
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <FilterChip active={active} onClick={() => setActive(!active)}>
              Solo disponibles
            </FilterChip>
            <FilterChip disabled>No disponible</FilterChip>
            <FilterChip
              variant="action"
              onClick={() => {
                setActive(false);
                setFeedback("Filtros restablecidos");
              }}
            >
              Restablecer
            </FilterChip>
          </div>
          <div className="mt-4">
            <SegmentedControl
              as="radio"
              label="Ámbito de la muestra"
              value={scope}
              onValueChange={setScope}
              items={[
                { value: "all", label: "Toda la biblioteca" },
                { value: "local", label: "Solo local" },
                { value: "blocked", label: "No disponible", disabled: true },
              ]}
            />
          </div>
        </article>
        <article aria-label="GenrePill">
          <h3 className="font-display text-xl">
            GenrePill · identidad musical
          </h3>
          <p className="mt-2 text-sm text-text-secondary">
            Nombre y porcentaje a 12 px. Mantiene procedencia y acciones
            independientes.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <GenrePill item={{ name: "Post-rock", source: "MusicBrainz" }} />
            <GenrePill item={{ name: "Drone", percent: 0 }} />
            <GenrePill item={{ name: "Noise", percent: 100 }} />
            <GenrePill
              item={{ name: "Ambient", share: 0.42, source: "Last.fm" }}
              onClick={() => setFeedback("Ambient seleccionado")}
              onRemove={() => setFeedback("Ambient retirado")}
              removeLabel="Retirar Ambient"
            />
          </div>
        </article>
      </div>
      <article aria-label="Etiquetas compuestas" className="mt-8">
        <h3 className="font-display text-xl">Etiquetas largas</h3>
        <div className="mt-4 flex flex-wrap gap-4">
          <div className="w-44 max-w-full" aria-label="Relación estrecha">
            <Badge variant="outline">
              <span>Nombre largo de relación musical</span>
              <span>long-relation-slug-that-does-not-fit</span>
              <button
                type="button"
                aria-label="Retirar relación de muestra"
                onClick={() => setFeedback("Relación retirada")}
              >
                ×
              </button>
            </Badge>
          </div>
          <div className="w-44 max-w-full" aria-label="Alias estrecho">
            <Badge variant="outline">
              alias: {"a-long-alias-with-composed-text"}
            </Badge>
          </div>
        </div>
      </article>
      <article aria-label="Labels y valores" className="mt-8">
        <h3 className="font-display text-xl">Labels y valores</h3>
        <label className="crate-form-field mt-4">
          <span data-slot="form-field-label">Nombre de muestra</span>
          <input
            aria-label="Nombre de muestra"
            defaultValue="First Song"
            className="crate-form-control"
          />
        </label>
        <label className="mt-4 flex items-center gap-3">
          <input type="checkbox" />
          <span data-slot="form-field-value">First Song · FLAC</span>
        </label>
      </article>
      <p role="status" className="mt-6 text-sm text-text-secondary">
        {feedback}
      </p>
      <p className="mt-4 text-sm text-text-muted">
        Datos ficticios de muestra. Se mantienen los contratos y acciones de
        producción; el contador superpuesto de cola conserva su receta
        específica.
      </p>
    </section>
  );
}
