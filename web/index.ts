export { DrawingScheduler, WebFrameDriver } from "./src/scheduler/index.js";
export { CanvasDrawingSession } from "./src/session/index.js";
export {
  WebErrorCodes,
  WebErrorDefinitions,
} from "./src/errors/WebErrorDefinitions.js";
export {
  WebError,
  WebRangeError,
  WebTypeError,
} from "./src/errors/WebErrors.js";

export type { WebErrorCode } from "./src/interfaces/errors/WebErrorCode.js";
export type { DrawingCommand } from "./src/interfaces/scheduler/DrawingCommand.js";
export type { DrawingSchedulerConfig } from "./src/interfaces/scheduler/DrawingSchedulerConfig.js";
export type { CanvasDrawingSessionConfig } from "./src/interfaces/session/CanvasDrawingSessionConfig.js";
export type {
  FrameCallback,
  FrameDriver,
} from "./src/interfaces/scheduler/FrameDriver.js";
