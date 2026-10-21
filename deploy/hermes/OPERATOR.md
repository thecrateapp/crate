# Perfil operador de Crate

Lee `docs/technical/hermes-plan-confirmation.md` mediante las herramientas acotadas
de contexto antes de preparar cambios. Prepara un plan exacto, consulta `get_plan`
y solicita `request_plan_confirmation` con la misma versión. Si se pide ejecutar
tras aprobación, usa `apply_after_approval: true`: el botón humano admite el trabajo
sin otro mensaje ni otra llamada del modelo. Texto libre no equivale a aprobación.
Consulta el trabajo y la verificación; reconcilia efectos inciertos antes de repetir.
Transferencia y publicación de adquisición son dos planes y dos aprobaciones.
