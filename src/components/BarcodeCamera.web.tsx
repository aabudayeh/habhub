import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { normalizeFoodBarcodeInput, webCameraErrorMessage } from "@/src/food/barcode";

import type { BarcodeCameraProps } from "./BarcodeCamera.types";

type ScannerControls = { stop: () => void };

export function BarcodeCamera({
  active,
  retryToken,
  style,
  onBarcodeScanned,
  onStatusChange,
}: BarcodeCameraProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const barcodeCallback = useRef(onBarcodeScanned);
  const statusCallback = useRef(onStatusChange);
  const [visibilityRevision, setVisibilityRevision] = useState(0);

  barcodeCallback.current = onBarcodeScanned;
  statusCallback.current = onStatusChange;

  useEffect(() => {
    const handleVisibility = () => setVisibilityRevision((value) => value + 1);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useEffect(() => {
    if (!active || document.visibilityState === "hidden") return;

    let cancelled = false;
    let controls: ScannerControls | undefined;

    const stop = () => {
      controls?.stop();
      controls = undefined;
      const stream = videoRef.current?.srcObject;
      if (stream instanceof MediaStream)
        stream.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    const start = async () => {
      if (!window.isSecureContext) {
        statusCallback.current(
          "error",
          "Camera scanning needs a secure HTTPS connection. Enter the barcode number below instead.",
        );
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        statusCallback.current(
          "error",
          "Camera scanning is not supported in this browser. Enter the barcode number below instead.",
        );
        return;
      }
      if (!videoRef.current) return;

      statusCallback.current("starting");
      try {
        // Expo Camera's web decoder currently recognizes QR codes only. Load
        // the 1-D decoder only while this screen is scanning so the regular
        // app bundle and native camera path stay lean.
        const { BarcodeFormat, BrowserMultiFormatReader } = await import(
          "@zxing/browser"
        );
        if (cancelled || !videoRef.current) return;

        const reader = new BrowserMultiFormatReader(undefined, {
          delayBetweenScanAttempts: 180,
          delayBetweenScanSuccess: 1_000,
          tryPlayVideoTimeout: 5_000,
        });
        reader.possibleFormats = [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
        ];
        controls = await reader.decodeFromConstraints(
          {
            audio: false,
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1_280 },
              height: { ideal: 720 },
            },
          },
          videoRef.current,
          (result) => {
            if (!result || cancelled) return;
            const barcode = normalizeFoodBarcodeInput(result.getText());
            if (barcode) barcodeCallback.current(barcode);
          },
        );
        if (cancelled) stop();
        else statusCallback.current("scanning");
      } catch (reason) {
        stop();
        if (!cancelled)
          statusCallback.current("error", webCameraErrorMessage(reason));
      }
    };

    void start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [active, retryToken, visibilityRevision]);

  return (
    <View style={style}>
      {React.createElement("video", {
        ref: videoRef,
        autoPlay: true,
        muted: true,
        playsInline: true,
        "aria-label": "Barcode camera preview",
        style: {
          width: "100%",
          height: "100%",
          objectFit: "cover",
          backgroundColor: "#111827",
        },
      })}
    </View>
  );
}
