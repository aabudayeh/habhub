import React, { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from "react-native";

import { useLocalization } from "@/src/i18n";
import { clampPageIndex, pageIndexFromOffset } from "@/src/domain/pagedLayout";
import { useAppColors } from "@/src/theme";

export function HorizontalPager({
  pages,
  accessibilityLabel,
  scrollEnabled = true,
  pageStyle,
  testID,
  requestedPage,
  onPageChange,
}: {
  pages: ReactNode[];
  accessibilityLabel: string;
  scrollEnabled?: boolean;
  pageStyle?: StyleProp<ViewStyle>;
  testID?: string;
  /** Imperatively select a page when an external action reveals new content. */
  requestedPage?: number;
  /** Mirrors swipe and dot navigation to compact indicators outside the pager. */
  onPageChange?: (page: number) => void;
}) {
  const colors = useAppColors();
  const { t } = useLocalization();
  const scrollRef = useRef<ScrollView>(null);
  const [pageWidth, setPageWidth] = useState(0);
  const [activePage, setActivePage] = useState(0);

  const moveToPage = useCallback(
    (requestedPage: number, animated = true) => {
      const page = clampPageIndex(requestedPage, pages.length);
      setActivePage(page);
      if (pageWidth > 0) {
        scrollRef.current?.scrollTo({ x: page * pageWidth, animated });
      }
    },
    [pageWidth, pages.length],
  );

  useEffect(() => {
    const next = clampPageIndex(activePage, pages.length);
    if (next !== activePage) setActivePage(next);
    if (pageWidth <= 0) return;
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ x: next * pageWidth, animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [activePage, pageWidth, pages.length]);

  useEffect(() => {
    onPageChange?.(clampPageIndex(activePage, pages.length));
  }, [activePage, onPageChange, pages.length]);

  useEffect(() => {
    if (requestedPage === undefined) return;
    const next = clampPageIndex(requestedPage, pages.length);
    setActivePage(next);
    if (pageWidth <= 0) return;
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ x: next * pageWidth, animated: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [pageWidth, pages.length, requestedPage]);

  const updateActivePage = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      setActivePage(
        pageIndexFromOffset(
          event.nativeEvent.contentOffset.x,
          pageWidth,
          pages.length,
        ),
      );
    },
    [pageWidth, pages.length],
  );

  const measure = useCallback((event: LayoutChangeEvent) => {
    const width = Math.round(event.nativeEvent.layout.width);
    if (width > 0) setPageWidth(width);
  }, []);

  if (!pages.length) return null;

  return (
    <View
      accessibilityLabel={t(accessibilityLabel)}
      onLayout={measure}
      style={styles.root}
      testID={testID}
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        nestedScrollEnabled
        directionalLockEnabled
        disableIntervalMomentum
        decelerationRate="fast"
        scrollEnabled={scrollEnabled && pages.length > 1}
        showsHorizontalScrollIndicator={false}
        snapToInterval={pageWidth > 0 ? pageWidth : undefined}
        snapToAlignment="start"
        scrollEventThrottle={16}
        onMomentumScrollEnd={updateActivePage}
        onScrollEndDrag={updateActivePage}
        style={styles.viewport}
      >
        {pages.map((page, index) => (
          <View
            key={index}
            style={[
              styles.page,
              pageWidth > 0 ? { width: pageWidth } : styles.unmeasuredPage,
              pageStyle,
            ]}
          >
            {Math.abs(index - activePage) <= 1 ? page : null}
          </View>
        ))}
      </ScrollView>
      {pages.length > 1 ? (
        <View style={styles.dots} accessibilityRole="tablist">
          {pages.map((_page, index) => {
            const selected = activePage === index;
            return (
              <Pressable
                key={index}
                accessibilityRole="tab"
                accessibilityLabel={t("Page {page} of {total}")
                  .replace("{page}", String(index + 1))
                  .replace("{total}", String(pages.length))}
                accessibilityState={{ selected }}
                onPress={() => moveToPage(index)}
                hitSlop={4}
                style={styles.dotButton}
              >
                <View
                  style={[
                    styles.dot,
                    {
                      backgroundColor: selected ? colors.muted : colors.border,
                      width: selected ? 15 : 6,
                    },
                  ]}
                />
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: "100%" },
  viewport: { width: "100%" },
  page: { alignSelf: "flex-start" },
  unmeasuredPage: { width: "100%" },
  dots: {
    minHeight: 26,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
    marginTop: 3,
  },
  dotButton: {
    width: 25,
    height: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: { height: 6, borderRadius: 999 },
});
