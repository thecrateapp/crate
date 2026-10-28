import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@crate/ui/shadcn/table";
import {
  Trash2,
  X,
  Plus,
  Pencil,
  Copy,
  Eye,
  ListRestart,
  Save,
  RefreshCw,
  RotateCcw,
  Undo2,
  Upload,
  Download,
} from "lucide-react";

const actionFamilies = [
  [
    Trash2,
    "Retirar / eliminar",
    "Regla, pista, portada o elemento de una fila",
    "Remove aplicado",
  ],
  [
    X,
    "Quitar valor / cerrar",
    "Tag, filtro individual, modal o panel",
    "UX vigente",
  ],
  [
    Plus,
    "Añadir",
    "Regla o valor dentro de un grupo identificado",
    "Propuesta",
  ],
  [Pencil, "Editar", "Elemento concreto de una fila o tarjeta", "Propuesta"],
  [
    Copy,
    "Copiar / duplicar",
    "Enlace, identificador o playlist",
    "Duplicate aplicado; otros propuestos",
  ],
  [Eye, "Previsualizar", "Simulación de la playlist", "Cabecera aplicada"],
  [
    ListRestart,
    "Generar playlist",
    "Generate / Save + generate",
    "Cabecera aplicada",
  ],
  [Save, "Guardar", "Cambios de esta playlist", "Cabecera aplicada"],
  [
    RefreshCw,
    "Actualizar lectura",
    "Snapshot o lista visible",
    "Cabeceras aplicadas",
  ],
  [RotateCcw, "Reintentar", "Operación fallida concreta", "Propuesta"],
  [Undo2, "Restaurar", "Elemento de la papelera", "Propuesta"],
  [Upload, "Subir archivo", "Portada o imagen", "Propuesta"],
  [
    Download,
    "Descargar / adquirir",
    "Track, álbum o release concreta",
    "Propuesta",
  ],
] as const;
export function AdminPlaylistEditorCheckpoint() {
  return (
    <section
      id="editor-playlists-admin"
      className="admin-baseline-feature"
      aria-label="Checkpoint 1AQ, PlaylistEditor de Admin"
    >
      <div className="specimen-heading">
        <div>
          <MonoLabel size="eyebrow" accent="41">
            Checkpoint 1AQ · En revisión
          </MonoLabel>
          <h2>Editar sin ruido.</h2>
        </div>
        <p>
          Acciones compactas arriba a la derecha, con tooltip y nombre
          accesible. Se conservan atrás, búsqueda, carga y el asa de arrastre.
        </p>
      </div>
      <p className="mt-6 text-sm text-text-muted">
        Editor real con datos ficticios, portada local y estados manuales. Las
        reglas, la simulación y las propuestas de IA conservan sus acciones;
        Remove usa papelera y Category, Match y Sort usan Select en creación y
        edición; Search scope usa Select en el buscador de pistas. Listen
        mantiene sus controles.
      </p>
      <p className="mt-4 text-sm text-text-muted">
        Migración de las 18 cabeceras revisadas: 38 acciones compactas, con
        nombres y tooltips precisos. Roles conserva solo lectura. Las acciones
        de fila de playlists siguen el mismo patrón y usan una sola capa de
        padding de 16 px. No se avanza al siguiente grupo antes de revisar 1AQ.
      </p>
      <details className="mt-6 border-y border-border-quiet py-4">
        <summary className="cursor-pointer text-sm">
          Inventario de acciones de Admin
        </summary>
        <p className="my-4 text-sm text-text-muted">
          71 sitios revisados: 45 acciones aplicadas, 11 propuestas y 15 sitios
          existentes para conservar o alinear en su fase. Esta tabla muestra el
          criterio. Las 18 cabeceras revisadas usan la composición común; Roles
          sigue sin acciones. Las filas de playlists usan Edit,
          Activate/Deactivate y Delete. Formularios y confirmaciones finales
          conservan texto.
        </p>
        <Table aria-label="Iconos de acciones de Admin">
          <TableHeader>
            <TableRow>
              <TableHead>Icono</TableHead>
              <TableHead>Acción</TableHead>
              <TableHead>Contexto</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {actionFamilies.map(([Glyph, action, context, status]) => (
              <TableRow key={action}>
                <TableCell>
                  <Glyph
                    data-action-icon-family={action}
                    aria-hidden="true"
                    size={20}
                  />
                </TableCell>
                <TableCell>{action}</TableCell>
                <TableCell>{context}</TableCell>
                <TableCell className="font-mono font-normal text-xs">
                  {status}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
      <iframe
        title="PlaylistEditor real con datos de muestra"
        src="./admin-playlist-editor-demo.html"
        className="mt-6 h-[1400px] w-full border border-border-quiet"
      />
      <a
        href="./admin-playlist-editor-demo.html"
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex min-h-11 items-center text-sm underline"
      >
        Abrir PlaylistEditor en una pestaña
      </a>
    </section>
  );
}
