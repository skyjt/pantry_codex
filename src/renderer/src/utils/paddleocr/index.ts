export {
    DEFAULT_DETECTION_OPTIONS,
    DEFAULT_PADDLE_OPTIONS,
    DEFAULT_PROCESS_RECOGNITION_OPTIONS,
    DEFAULT_RECOGNITION_OPTIONS,
    DEFAULT_RECOGNITION_ORDERING_OPTIONS,
} from "./constants";

export type {
    Box,
    DetectionRuntimeOptions,
    DetectionServiceOptions,
    OcrProgress,
    OrtInferenceSession,
    OrtModule,
    OrtTensor,
    PaddleOcrProgressEvent,
    PaddleOptions,
    ProcessRecognitionOptions,
    RecognitionOptions,
    RecognitionOrderingOptions,
    RecognitionRuntimeOptions,
    RecognitionServiceOptions,
} from "./interface";

export { DetectionService, type PreprocessDetectionResult } from "./processor/detection";
export {
    type FlattenedPaddleOcrResult,
    type PaddleOcrResult,
    PaddleOcrService,
} from "./processor/paddle-ocr";
export { type RecognitionResult, RecognitionService } from "./processor/recognition";
