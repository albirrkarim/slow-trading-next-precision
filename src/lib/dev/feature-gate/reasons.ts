/** Groups gate explanations that differ only by measured numeric values. */
function template(message: string): string {
  return message.replace(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?%?/gi, "#");
}

const reasons = { template } as const;
export default reasons;
