import type { StyleProp, ViewStyle } from "react-native";

export type BarcodeCameraStatus = "starting" | "scanning" | "error";

export type BarcodeCameraProps = {
  active: boolean;
  retryToken: number;
  style?: StyleProp<ViewStyle>;
  onBarcodeScanned: (data: string) => void;
  onStatusChange: (status: BarcodeCameraStatus, message?: string) => void;
};
