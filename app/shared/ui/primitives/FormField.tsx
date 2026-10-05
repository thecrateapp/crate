import {
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from "react";

import { cn } from "@crate/ui/lib/cn";

export interface FormFieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
}

type FormFieldChildProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  "aria-required"?: boolean | "true" | "false";
};

export interface FormFieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  id?: string;
  required?: boolean;
  className?: string;
  labelClassName?: string;
  children:
    | ReactElement<FormFieldChildProps>
    | ((control: FormFieldControlProps) => ReactNode);
}

function hasContent(node: ReactNode) {
  return node !== undefined && node !== null && node !== false && node !== "";
}

export function FormField({
  label,
  hint,
  error,
  id,
  required = false,
  className,
  labelClassName,
  children,
}: FormFieldProps) {
  const generatedId = useId();
  const childId =
    typeof children !== "function" && isValidElement(children)
      ? children.props.id
      : undefined;
  const controlId = id ?? childId ?? `${generatedId}-control`;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const showHint = hasContent(hint);
  const showError = hasContent(error);

  const describedBy =
    [showHint ? hintId : null, showError ? errorId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  const control: FormFieldControlProps = {
    id: controlId,
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
    ...(showError ? { "aria-invalid": true as const } : {}),
    ...(required ? { "aria-required": true as const } : {}),
  };

  let renderedControl: ReactNode;
  if (typeof children === "function") {
    renderedControl = children(control);
  } else {
    const existingDescribedBy = children.props["aria-describedby"];
    renderedControl = cloneElement(children, {
      ...control,
      "aria-describedby":
        [existingDescribedBy, describedBy].filter(Boolean).join(" ") ||
        undefined,
      "aria-invalid": showError ? true : children.props["aria-invalid"],
    });
  }

  return (
    <div
      data-slot="form-field"
      data-invalid={showError || undefined}
      className={cn("grid gap-1.5", className)}
    >
      {hasContent(label) ? (
        <label
          htmlFor={controlId}
          data-slot="form-field-label"
          className={cn(
            "text-sm font-medium text-text-primary",
            showError && "text-state-danger-text",
            labelClassName,
          )}
        >
          {label}
          {required ? (
            <span aria-hidden="true" className="ml-0.5 text-state-danger-text">
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {renderedControl}
      {showHint ? (
        <p
          id={hintId}
          data-slot="form-field-hint"
          className="text-xs text-text-muted"
        >
          {hint}
        </p>
      ) : null}
      {showError ? (
        <p
          id={errorId}
          data-slot="form-field-error"
          role="alert"
          className="text-xs text-state-danger-text"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
