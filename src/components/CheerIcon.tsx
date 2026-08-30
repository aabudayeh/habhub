import { MaterialCommunityIcons } from "@expo/vector-icons";

type CheerIconProps = {
  color: string;
  size?: number;
};

/** App-styled party popper used consistently for the Cheer reaction. */
export function CheerIcon({ color, size = 16 }: CheerIconProps) {
  return (
    <MaterialCommunityIcons
      name="party-popper"
      size={size}
      color={color}
    />
  );
}
