#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct WorkArea {
    pub bounds: WindowBounds,
    pub scale_factor: f64,
}

pub(super) fn select_work_area(window: WindowBounds, work_areas: &[WorkArea]) -> Option<&WorkArea> {
    work_areas.iter().max_by_key(|work_area| {
        let intersection = intersection_area(window, work_area.bounds);
        if intersection > 0 {
            intersection
        } else {
            -distance_squared(window, work_area.bounds)
        }
    })
}

pub(super) fn clamp_to_work_area(window: WindowBounds, work_area: WindowBounds) -> WindowBounds {
    let width = window.width.max(1).min(work_area.width.max(1));
    let height = window.height.max(1).min(work_area.height.max(1));
    let max_x = i64::from(work_area.x) + i64::from(work_area.width.saturating_sub(width));
    let max_y = i64::from(work_area.y) + i64::from(work_area.height.saturating_sub(height));

    WindowBounds {
        x: i64::from(window.x)
            .clamp(i64::from(work_area.x), max_x)
            .clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        y: i64::from(window.y)
            .clamp(i64::from(work_area.y), max_y)
            .clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        width,
        height,
    }
}

pub(super) fn physical_minimum(logical: f64, scale_factor: f64, available: u32) -> u32 {
    let logical = if logical.is_finite() && logical > 0.0 {
        logical
    } else {
        1.0
    };
    let scale_factor = if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    };

    ((logical * scale_factor).ceil() as u32)
        .max(1)
        .min(available.max(1))
}

fn intersection_area(left: WindowBounds, right: WindowBounds) -> i128 {
    let width = (right_edge(left).min(right_edge(right))
        - i64::from(left.x).max(i64::from(right.x)))
    .max(0);
    let height = (bottom_edge(left).min(bottom_edge(right))
        - i64::from(left.y).max(i64::from(right.y)))
    .max(0);
    i128::from(width) * i128::from(height)
}

fn distance_squared(left: WindowBounds, right: WindowBounds) -> i128 {
    let left_center_x = i64::from(left.x) * 2 + i64::from(left.width);
    let left_center_y = i64::from(left.y) * 2 + i64::from(left.height);
    let right_center_x = i64::from(right.x) * 2 + i64::from(right.width);
    let right_center_y = i64::from(right.y) * 2 + i64::from(right.height);
    let dx = i128::from(left_center_x - right_center_x);
    let dy = i128::from(left_center_y - right_center_y);
    dx * dx + dy * dy
}

fn right_edge(bounds: WindowBounds) -> i64 {
    i64::from(bounds.x) + i64::from(bounds.width)
}

fn bottom_edge(bounds: WindowBounds) -> i64 {
    i64::from(bounds.y) + i64::from(bounds.height)
}

#[cfg(test)]
mod tests {
    use super::{clamp_to_work_area, physical_minimum, select_work_area, WindowBounds, WorkArea};

    #[test]
    fn clamps_to_the_monitor_work_area_without_covering_panel_space() {
        let window = WindowBounds {
            x: 2000,
            y: -300,
            width: 1600,
            height: 1000,
        };
        let work_area = WindowBounds {
            x: 0,
            y: 48,
            width: 1920,
            height: 1032,
        };

        assert_eq!(
            clamp_to_work_area(window, work_area),
            WindowBounds {
                x: 320,
                y: 48,
                width: 1600,
                height: 1000,
            }
        );
    }

    #[test]
    fn shrinks_a_window_that_is_larger_than_the_available_work_area() {
        let window = WindowBounds {
            x: 5000,
            y: 5000,
            width: 1800,
            height: 1200,
        };
        let work_area = WindowBounds {
            x: -1280,
            y: 30,
            width: 1280,
            height: 690,
        };

        assert_eq!(
            clamp_to_work_area(window, work_area),
            WindowBounds {
                x: -1280,
                y: 30,
                width: 1280,
                height: 690,
            }
        );
    }

    #[test]
    fn chooses_the_monitor_with_the_largest_overlap() {
        let window = WindowBounds {
            x: 900,
            y: 100,
            width: 400,
            height: 400,
        };
        let primary = WorkArea {
            bounds: WindowBounds {
                x: 0,
                y: 0,
                width: 1000,
                height: 800,
            },
            scale_factor: 1.0,
        };
        let secondary = WorkArea {
            bounds: WindowBounds {
                x: 1000,
                y: 0,
                width: 1200,
                height: 900,
            },
            scale_factor: 2.0,
        };

        assert_eq!(
            select_work_area(window, &[primary, secondary]),
            Some(&secondary)
        );
    }

    #[test]
    fn moves_a_window_back_from_a_disconnected_monitor_to_the_nearest_one() {
        let stale_window = WindowBounds {
            x: 4000,
            y: 100,
            width: 1280,
            height: 820,
        };
        let remaining = WorkArea {
            bounds: WindowBounds {
                x: -1920,
                y: 40,
                width: 1920,
                height: 1040,
            },
            scale_factor: 1.0,
        };

        let work_areas = [remaining];
        let selected = select_work_area(stale_window, &work_areas).unwrap();
        assert_eq!(selected, &remaining);
        assert_eq!(
            clamp_to_work_area(stale_window, selected.bounds),
            WindowBounds {
                x: -1280,
                y: 100,
                width: 1280,
                height: 820,
            }
        );
    }

    #[test]
    fn scales_logical_minimums_and_caps_them_to_small_displays() {
        assert_eq!(physical_minimum(1024.0, 2.0, 3000), 2048);
        assert_eq!(physical_minimum(700.0, 2.0, 1200), 1200);
    }
}
