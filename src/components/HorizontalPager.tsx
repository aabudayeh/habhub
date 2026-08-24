import React, {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  PanResponder,
  Platform,
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
  showPageDots = true,
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
  /** Hide built-in dots when the surrounding screen already renders them. */
  showPageDots?: boolean;
}) {
  const colors = useAppColors();
  const { t } = useLocalization();
  const scrollRef = useRef<ScrollView>(null);
  const activePageRef = useRef(0);
  const scrollOffsetRef = useRef(0);
  const webDragStartOffsetRef = useRef(0);
  const webDragStartPageRef = useRef(0);
  const [pageWidth, setPageWidth] = useState(0);
  const [activePage, setActivePage] = useState(0);

  const commitActivePage = useCallback((page: number) => {
    activePageRef.current = page;
    setActivePage((current) => (current === page ? current : page));
  }, []);

  const moveToPage = useCallback(
    (requestedPage: number, animated = true) => {
      const page = clampPageIndex(requestedPage, pages.length);
      commitActivePage(page);
      if (pageWidth > 0) {
        scrollOffsetRef.current = page * pageWidth;
        scrollRef.current?.scrollTo({ x: page * pageWidth, animated });
      }
    },
    [commitActivePage, pageWidth, pages.length],
  );

  useEffect(() => {
    const next = clampPageIndex(activePageRef.current, pages.length);
    commitActivePage(next);
    if (pageWidth <= 0) return;
    // Realign only when the viewport width or page count changes. Tying this
    // correction to `activePage` interrupts an in-progress Web scroll with a
    // second, non-animated scrollTo and creates a one-frame duplicate/snap.
    const frame = requestAnimationFrame(() => {
      scrollOffsetRef.current = next * pageWidth;
      scrollRef.current?.scrollTo({ x: next * pageWidth, animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [commitActivePage, pageWidth, pages.length]);

  useEffect(() => {
    onPageChange?.(clampPageIndex(activePage, pages.length));
  }, [activePage, onPageChange, pages.length]);

  useEffect(() => {
    if (requestedPage === undefined) return;
    const next = clampPageIndex(requestedPage, pages.length);
    commitActivePage(next);
    if (pageWidth <= 0) return;
    const frame = requestAnimationFrame(() => {
      scrollOffsetRef.current = next * pageWidth;
      scrollRef.current?.scrollTo({ x: next * pageWidth, animated: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [commitActivePage, pageWidth, pages.length, requestedPage]);

  const updateActivePage = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollOffsetRef.current = event.nativeEvent.contentOffset.x;
      commitActivePage(
        pageIndexFromOffset(event.nativeEvent.contentOffset.x, pageWidth, pages.length),
      );
    },
    [commitActivePage, pageWidth, pages.length],
  );

  const measure = useCallback((event: LayoutChangeEvent) => {
    const width = Math.round(event.nativeEvent.layout.width);
    if (width > 0) setPageWidth(width);
  }, []);

  const webPointerDrag = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          Platform.OS === "web" &&
          scrollEnabled &&
          pages.length > 1 &&
          Math.abs(gesture.dx) > 7 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.15,
        onPanResponderGrant: () => {
          webDragStartOffsetRef.current = scrollOffsetRef.current;
          webDragStartPageRef.current = pageIndexFromOffset(
            scrollOffsetRef.current,
            pageWidth,
            pages.length,
          );
        },
        onPanResponderMove: (_event, gesture) => {
          if (pageWidth <= 0) return;
          const maximumOffset = Math.max(0, (pages.length - 1) * pageWidth);
          const offset = Math.max(
            0,
            Math.min(maximumOffset, webDragStartOffsetRef.current - gesture.dx),
          );
          scrollOffsetRef.current = offset;
          scrollRef.current?.scrollTo({ x: offset, animated: false });
        },
        onPanResponderRelease: (_event, gesture) => {
          if (pageWidth <= 0) return;
          const crossedPageThreshold =
            Math.abs(gesture.dx) >= Math.min(52, pageWidth * 0.14) ||
            Math.abs(gesture.vx) >= 0.35;
          const target = crossedPageThreshold
            ? webDragStartPageRef.current + (gesture.dx < 0 ? 1 : -1)
            : pageIndexFromOffset(
                scrollOffsetRef.current,
                pageWidth,
                pages.length,
              );
          moveToPage(target);
        },
        onPanResponderTerminate: () => {
          moveToPage(
            pageIndexFromOffset(
              scrollOffsetRef.current,
              pageWidth,
              pages.length,
            ),
          );
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => false,
      }),
    [moveToPage, pageWidth, pages.length, scrollEnabled],
  );

  if (!pages.length) return null;

  return (
    <View
      {...(Platform.OS === "web" ? webPointerDrag.panHandlers : {})}
      accessibilityLabel={t(accessibilityLabel)}
      onLayout={measure}
      style={[
        styles.root,
        Platform.OS === "web"
          ? ({
              cursor:
                scrollEnabled && pages.length > 1 ? "pointer" : "default",
            } as ViewStyle)
          : undefined,
      ]}
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
        onScroll={Platform.OS === "web" ? updateActivePage : undefined}
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
            {/* Web browsers can briefly composite an unmounted/remounted page
                at its old scroll position. Keep Web page contents stable for
                the whole gesture; native retains the bounded adjacent-page
                rendering optimization. */}
            {Platform.OS === "web" || Math.abs(index - activePage) <= 1
              ? page
              : null}
          </View>
        ))}
      </ScrollView>
      {showPageDots && pages.length > 1 ? (
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
