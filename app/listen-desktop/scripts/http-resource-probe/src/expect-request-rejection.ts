export function expectRequestRejection(
  request: Promise<unknown>,
  successMessage: string,
): Promise<void> {
  return request.then(
    () => {
      throw new Error(successMessage);
    },
    () => undefined,
  );
}
