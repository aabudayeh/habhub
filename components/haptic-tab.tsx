import { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { PlatformPressable } from '@react-navigation/elements';
import * as Haptics from 'expo-haptics';
import { TutorialTarget } from '@/src/components/TutorialSpotlight';

export function HapticTab(
  props: BottomTabBarButtonProps & { tutorialId?: string },
) {
  const { tutorialId, ...buttonProps } = props;
  const button = (
    <PlatformPressable
      {...buttonProps}
      onPressIn={(ev) => {
        if (process.env.EXPO_OS === 'ios') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        props.onPressIn?.(ev);
      }}
    />
  );
  if (!tutorialId) return button;
  return (
    <TutorialTarget id={tutorialId} style={{ flex: 1 }}>
      {button}
    </TutorialTarget>
  );
}
