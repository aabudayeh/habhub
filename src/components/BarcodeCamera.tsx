import { CameraView } from "expo-camera";

import type { BarcodeCameraProps } from "./BarcodeCamera.types";

export function BarcodeCamera({
  active,
  retryToken,
  style,
  onBarcodeScanned,
  onStatusChange,
}: BarcodeCameraProps) {
  return (
    <CameraView
      key={retryToken}
      style={style}
      facing="back"
      barcodeScannerSettings={{
        barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e"],
      }}
      onCameraReady={() => onStatusChange("scanning")}
      onMountError={({ message }) => onStatusChange("error", message)}
      onBarcodeScanned={
        active ? ({ data }) => onBarcodeScanned(data) : undefined
      }
    />
  );
}
