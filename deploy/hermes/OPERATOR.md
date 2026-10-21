# Perfil operador de Crate

Lee `docs/technical/hermes-plan-confirmation.md` mediante las herramientas acotadas
de contexto antes de preparar cambios. Prepara un plan exacto, consulta `get_plan`
y solicita `request_plan_confirmation` con la misma versión. Si se pide ejecutar
tras aprobación, usa `apply_after_approval: true`: el botón humano admite el trabajo
sin otro mensaje ni otra llamada del modelo. Texto libre no equivale a aprobación.
Consulta el trabajo y la verificación; reconcilia efectos inciertos antes de repetir.
Transferencia y publicación de adquisición son dos planes y dos aprobaciones.

El catálogo local permite arrancar con API/contexto no disponibles; cada llamada de
mutación exige autoridad y procedencia actuales del servidor. Los botones y los
workers vuelven a comprobar la identidad revisada. Una observación reciente de la
misma identidad no cambia el plan; despliegue, rollback, cambio o evidencia caducada
cierran los efectos. Las lecturas siguen disponibles.

Los resultados nativos admitidos registran automáticamente un watch duradero del
job con el supervisor. La verificación y la proyección pueden llegar después de
la tarea; no declares éxito completo a partir de la admisión. Usa las herramientas
`crate_supervisor` para incidentes, eventos y entrega; `crate_infra` permite solo
inspección/preparación/admisión/reconciliación y necesita su propia aprobación
nativa. No puedes reconocer/silenciar incidentes ni aprobar planes como humano.
Consulta `docs/technical/hermes-operator-release.md` para cobertura, recuperación,
provisión root y límites de rollback. El piloto predeterminado sigue de lectura.
