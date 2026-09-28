/**
 * Temporarily observes a runtime method in the profiling page only.
 * Reflection lets this harness count internal work without adding a library API.
 * @param target - Runtime object whose named method is observed in this page.
 * @param name - Existing method name; a changed internal shape fails loudly.
 * @param observe - Receives arguments, result, and inclusive elapsed milliseconds after a successful call.
 * @returns A function restoring the original property descriptor.
 */
export default function tapPanMethod(
  target: object,
  name: string,
  observe: (
    args: readonly unknown[],
    result: unknown,
    duration: number,
  ) => void,
): () => void {
  const original: unknown = Reflect.get(target, name);
  const descriptor = Object.getOwnPropertyDescriptor(target, name);
  if (typeof original !== "function")
    throw new Error(`Missing profiling method: ${name}`);
  Object.defineProperty(target, name, {
    configurable: true,
    value: function (this: object, ...args: unknown[]): unknown {
      const start = performance.now();
      const result: unknown = Reflect.apply(original, this, args);
      observe(args, result, performance.now() - start);
      return result;
    },
  });
  return () => {
    if (descriptor === undefined) Reflect.deleteProperty(target, name);
    else Object.defineProperty(target, name, descriptor);
  };
}
