import {
    DEFAULT_DETECTION_OPTIONS,
    DEFAULT_PADDLE_OPTIONS,
    DEFAULT_PROCESS_RECOGNITION_OPTIONS,
    DEFAULT_RECOGNITION_OPTIONS,
    DEFAULT_RECOGNITION_ORDERING_OPTIONS,
} from "../constants";
import type {
    DetectionRuntimeOptions,
    ImageInput,
    OrtInferenceSession,
    PaddleOptions,
    ProcessRecognitionOptions,
    RecognitionOptions,
    RecognitionOrderingOptions,
    RecognitionRuntimeOptions,
} from "../interface";
import { Image } from "../utils/image";
import { DetectionService } from "./detection";
import { type RecognitionResult, RecognitionService } from "./recognition";

export interface PaddleOcrResult {
    text: string;
    lines: RecognitionResult[][];
    confidence: number;
}

export interface FlattenedPaddleOcrResult {
    text: string;
    results: RecognitionResult[];
    confidence: number;
}

/**
 * PaddleOcrService - Provides OCR functionality using PaddleOCR models
 *
 * This service can be used either as a singleton or as separate instances
 * depending on your application needs.
 */
export class PaddleOcrService {
    options: PaddleOptions;

    detectionSession: OrtInferenceSession | null = null;
    detectionService: DetectionService | null = null;

    recognitionSession: OrtInferenceSession | null = null;
    recognitionService: RecognitionService | null = null;

    /**
     * Create a new PaddleOcrService instance
     * @param options Optional configuration options
     */
    constructor(options?: Partial<PaddleOptions>) {
        if (!options?.ort) {
            throw new Error(
                "PaddleOcrService requires the 'ort' option to be set with onnxruntime-node or onnxruntime-wen."
            );
        }
        this.options = {
            ...DEFAULT_PADDLE_OPTIONS,
            ...(options || {}),
        };
    }

    /**
     * Initialize the OCR service by loading models
     */
    public async initialize(): Promise<void> {
        const ort = this.options.ort;
        if (!ort) {
            throw new Error(
                "PaddleOcrService requires the 'ort' option to be set with onnxruntime-node or onnxruntime-wen."
            );
        }

        // Init detection service
        const detectionModelBuffer = this.options.detection?.modelBuffer;
        if (!detectionModelBuffer) {
            throw new Error(
                "Detection model buffer is required. Please provide a valid ONNX model."
            );
        }
        this.detectionSession = await ort.InferenceSession.create(detectionModelBuffer);
        const { modelBuffer: _detectionModelBuffer, ...detectionOptions } =
            this.options.detection ?? {};
        this.detectionService = new DetectionService(ort, this.detectionSession, detectionOptions);

        // Init recognition service
        const recognitionModelBuffer = this.options.recognition?.modelBuffer;
        if (!recognitionModelBuffer) {
            throw new Error(
                "Recognition model buffer is required. Please provide a valid ONNX model."
            );
        }
        this.recognitionSession = await ort.InferenceSession.create(recognitionModelBuffer);
        const { modelBuffer: _recognitionModelBuffer, ...recognitionOptions } =
            this.options.recognition ?? {};
        this.recognitionService = new RecognitionService(
            ort,
            this.recognitionSession,
            recognitionOptions
        );
    }

    /**
     * Check if the service is initialized with models loaded
     */
    public isInitialized(): boolean {
        return this.detectionSession !== null && this.recognitionSession !== null;
    }

    /**
     * Create a new instance instead of using the singleton
     * This is useful when you need multiple instances with different models
     * @param options Configuration options for this specific instance
     */
    public static async createInstance(options?: PaddleOptions): Promise<PaddleOcrService> {
        const instance = new PaddleOcrService(options);
        await instance.initialize();

        return instance;
    }

    private resolveDetectionRuntimeOptions(
        options: Partial<DetectionRuntimeOptions> = {}
    ): DetectionRuntimeOptions {
        const { modelBuffer: _modelBuffer, ...instanceOptions } = this.options.detection ?? {};

        return {
            ...DEFAULT_DETECTION_OPTIONS,
            ...instanceOptions,
            ...options,
        };
    }

    private resolveRecognitionRuntimeOptions(
        options: Partial<RecognitionRuntimeOptions> = {}
    ): RecognitionRuntimeOptions {
        const { modelBuffer: _modelBuffer, ...instanceOptions } = this.options.recognition ?? {};

        return {
            ...DEFAULT_RECOGNITION_OPTIONS,
            ...instanceOptions,
            ...options,
        };
    }

    private resolveRecognitionOrderingOptions(
        options: Partial<RecognitionOrderingOptions> = {}
    ): RecognitionOrderingOptions {
        return {
            ...DEFAULT_RECOGNITION_ORDERING_OPTIONS,
            ...options,
        };
    }

    /**
     * Runs object detection on the provided image input, then performs
     * recognition on the detected regions.
     *
     * @param image - The raw image data as an ArrayBuffer or Canvas.
     * @param options - Optional configuration for the recognition output, e.g., `{ flatten: true }`.
     * @return A promise that resolves to the OCR result, either grouped by lines or as a flat list.
     */
    public async recognize(
        input: ImageInput,
        options?: RecognitionOptions
    ): Promise<RecognitionResult[]> {
        if (!this.detectionService || !this.recognitionService) {
            throw new Error("PaddleOcrService is not initialized. Please call initialize() first.");
        }
        const channels = input.data.length / (input.width * input.height);
        if (!Number.isInteger(channels) || channels < 1 || channels > 4) {
            throw new Error(
                `Invalid input data: ${input.data} for image size ${input.width}x${input.height}. Expected 1, 3, or 4 channels.`
            );
        }
        const detectionRuntimeOptions = this.resolveDetectionRuntimeOptions(options?.detection);
        const recognitionRuntimeOptions = this.resolveRecognitionRuntimeOptions(
            options?.recognition
        );
        const orderingOptions = this.resolveRecognitionOrderingOptions(options?.ordering);
        if (!recognitionRuntimeOptions.charactersDictionary?.length) {
            throw new Error(
                "Recognition charactersDictionary is required. Provide it in createInstance({ recognition }) or recognize(_, { recognition })."
            );
        }
        let image = new Image(input.width, input.height, channels, input.data);

        const padding = detectionRuntimeOptions.padding;
        if (padding) {
            image = image.padding({
                padding,
                color: [255, 255, 255, 255],
            });
        }
        const detection = await this.detectionService.run(image, {
            ...detectionRuntimeOptions,
            onProgress: options?.onProgress,
        });
        const recognition = await this.recognitionService.run(image, detection, {
            ...options,
            detection: detectionRuntimeOptions,
            recognition: recognitionRuntimeOptions,
            ordering: orderingOptions,
        });

        return recognition;
    }

    /**
     * Processes raw recognition results to generate the final text,
     * grouped lines, and overall confidence.
     */
    processRecognition(
        recognition: RecognitionResult[],
        options?: ProcessRecognitionOptions
    ): PaddleOcrResult {
        const result: PaddleOcrResult = {
            text: "",
            lines: [],
            confidence: 0,
        };

        if (!recognition.length) {
            return result;
        }

        // Calculate overall confidence as the average of all individual confidences
        const totalConfidence = recognition.reduce((sum, r) => sum + r.confidence, 0);
        result.confidence = totalConfidence / recognition.length;
        const processOptions = {
            ...DEFAULT_PROCESS_RECOGNITION_OPTIONS,
            ...options,
        };

        let currentLine: RecognitionResult[] = [recognition[0]];
        let fullText = recognition[0].text;
        let avgHeight = recognition[0].box.height;

        for (let i = 1; i < recognition.length; i++) {
            const current = recognition[i];
            const previous = recognition[i - 1];

            const verticalGap = Math.abs(current.box.y - previous.box.y);
            const threshold = avgHeight * processOptions.lineMergeThresholdRatio;

            if (verticalGap <= threshold) {
                currentLine.push(current);
                fullText += ` ${current.text}`;

                avgHeight =
                    currentLine.reduce((sum, r) => sum + r.box.height, 0) / currentLine.length;
            } else {
                result.lines.push([...currentLine]);

                fullText += `\n${current.text}`;

                currentLine = [current];
                avgHeight = current.box.height;
            }
        }

        if (currentLine.length > 0) {
            result.lines.push([...currentLine]);
        }

        result.text = fullText;
        return result;
    }

    /**
     * Releases the onnx runtime session for both
     * detection and recognition model.
     */
    public async destroy(): Promise<void> {
        await this.detectionSession?.release?.();
        await this.recognitionSession?.release?.();
    }
}

export default PaddleOcrService;
