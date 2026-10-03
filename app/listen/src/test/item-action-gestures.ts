import { act, fireEvent } from "@testing-library/react";

export async function longPress(element: Element) {
  fireEvent.pointerDown(element, { pointerType: "touch" });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 450));
  });
  fireEvent.pointerUp(element, { pointerType: "touch" });
}

export function pressMenuKey(element: Element) {
  fireEvent.keyDown(element, { key: "ContextMenu" });
}
