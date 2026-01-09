declare module "pino-pretty" {
  type PrettyOptions = {
    colorize?: boolean;
    translateTime?: string;
    ignore?: string;
  };
  function pretty(options?: PrettyOptions): NodeJS.WritableStream;
  export default pretty;
}
