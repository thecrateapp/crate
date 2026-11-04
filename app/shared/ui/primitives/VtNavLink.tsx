import { useCallback } from "react";
import { flushSync } from "react-dom";
import { NavLink, useNavigate, type NavLinkProps } from "react-router";

/**
 * NavLink that triggers the View Transitions API on click.
 * Drop-in replacement for <NavLink> — same props, same render.
 * Falls back to instant navigation on unsupported browsers.
 */
export function VtNavLink({ onClick, to, ...props }: NavLinkProps) {
  const navigate = useNavigate();

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      onClick?.(e);
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();

      const hasTransparentLinuxWindowChrome =
        document.documentElement.dataset.crateLinuxWindowChrome === "true";

      if (!document.startViewTransition || hasTransparentLinuxWindowChrome) {
        navigate(to);
        return;
      }
      const transition = document.startViewTransition(() => {
        flushSync(() => {
          navigate(to);
        });
      });
      // The browser skips the animation when the viewport resizes or another
      // transition starts ("InvalidStateError: Transition was aborted because
      // of invalid state") and rejects these promises; the navigation itself
      // already happened. updateCallbackDone stays unhandled so a failure of
      // the navigation callback is still reported.
      transition?.ready?.catch(ignoreSkippedTransition);
      transition?.finished?.catch(ignoreSkippedTransition);
    },
    [navigate, onClick, to],
  );

  return <NavLink to={to} onClick={handleClick} {...props} />;
}

function ignoreSkippedTransition(): void {}
