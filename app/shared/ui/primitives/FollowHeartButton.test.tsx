import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FollowHeartButton } from "./FollowHeartButton";

describe("FollowHeartButton", () => {
  it("shows the active pulse and reverses the particle transition", () => {
    const onClick = vi.fn();
    let following = false;
    const { rerender } = render(
      <FollowHeartButton
        following={following}
        aria-label="Follow"
        heartTestId="follow-heart"
        particlesTestId="follow-particles"
        onClick={onClick}
      />,
    );

    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("follow-heart")).not.toHaveClass(
      "animate-crate-icon-active-pulse",
    );

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByTestId("follow-particles")).not.toHaveClass(
      "crate-follow-particles--unfollow",
    );
    expect(screen.getByTestId("follow-heart")).toHaveClass(
      "animate-crate-icon-active-pulse",
      "crate-follow-heart-in",
    );
    expect(onClick).toHaveBeenCalledTimes(1);

    following = true;
    rerender(
      <FollowHeartButton
        following={following}
        aria-label="Unfollow"
        heartTestId="follow-heart"
        particlesTestId="follow-particles"
        onClick={onClick}
      />,
    );
    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByTestId("follow-particles")).toHaveClass(
      "crate-follow-particles--unfollow",
    );
    expect(screen.getByTestId("follow-heart")).toHaveClass(
      "crate-follow-heart-out",
    );
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("varies each follow burst while keeping unfollow geometry stable", () => {
    let randomValue = 0.2;
    const random = vi
      .spyOn(Math, "random")
      .mockImplementation(() => randomValue);

    try {
      const { rerender } = render(
        <FollowHeartButton
          following={false}
          aria-label="Follow"
          particlesTestId="follow-particles"
        />,
      );

      fireEvent.click(screen.getByRole("button"));
      const firstParticle = screen
        .getByTestId("follow-particles")
        .querySelector<HTMLElement>(".crate-follow-particle");
      const firstBurst = {
        endX: firstParticle?.style.getPropertyValue("--follow-particle-end-x"),
        midX: firstParticle?.style.getPropertyValue("--follow-particle-mid-x"),
        duration: firstParticle?.style.getPropertyValue(
          "--follow-particle-duration",
        ),
      };

      randomValue = 0.8;
      fireEvent.click(screen.getByRole("button"));
      const secondParticle = screen
        .getByTestId("follow-particles")
        .querySelector<HTMLElement>(".crate-follow-particle");
      const secondBurst = {
        endX: secondParticle?.style.getPropertyValue("--follow-particle-end-x"),
        midX: secondParticle?.style.getPropertyValue("--follow-particle-mid-x"),
        duration: secondParticle?.style.getPropertyValue(
          "--follow-particle-duration",
        ),
      };

      expect(firstBurst).not.toEqual(secondBurst);

      rerender(
        <FollowHeartButton
          following={true}
          aria-label="Unfollow"
          particlesTestId="follow-particles"
        />,
      );
      fireEvent.click(screen.getByRole("button"));
      const unfollowParticle = screen
        .getByTestId("follow-particles")
        .querySelector<HTMLElement>(".crate-follow-particle");

      expect(
        unfollowParticle?.style.getPropertyValue("--follow-particle-end-x"),
      ).toBe("-16px");
      expect(
        unfollowParticle?.style.getPropertyValue("--follow-particle-duration"),
      ).toBe("760ms");
    } finally {
      random.mockRestore();
    }
  });

  it("keeps the staggered unfollow burst mounted until it finishes", () => {
    vi.useFakeTimers();

    try {
      render(
        <FollowHeartButton
          following={true}
          aria-label="Unfollow"
          particlesTestId="unfollow-particles"
        />,
      );

      fireEvent.click(screen.getByRole("button"));
      act(() => vi.advanceTimersByTime(900));

      expect(screen.getByTestId("unfollow-particles")).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(500));
      expect(
        screen.queryByTestId("unfollow-particles"),
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("FollowHeartButton labels and loading", () => {
  it("uses label and labelActive depending on state", () => {
    const { rerender } = render(
      <FollowHeartButton
        following={false}
        label="Follow"
        labelActive="Unfollow"
      />,
    );
    expect(
      screen.getByRole("button", { name: "Follow", pressed: false }),
    ).toBeInTheDocument();

    rerender(
      <FollowHeartButton following label="Follow" labelActive="Unfollow" />,
    );
    expect(
      screen.getByRole("button", { name: "Unfollow", pressed: true }),
    ).toBeInTheDocument();
  });

  it("falls back to label when labelActive is missing", () => {
    render(<FollowHeartButton following label="Saved" />);
    expect(screen.getByRole("button", { name: "Saved" })).toBeInTheDocument();
  });

  it("keeps an explicit aria-label", () => {
    render(
      <FollowHeartButton
        following={false}
        label="Follow"
        aria-label="Custom"
      />,
    );
    expect(screen.getByRole("button", { name: "Custom" })).toBeInTheDocument();
  });

  it("disables, marks busy and spins while loading", () => {
    const onClick = vi.fn();
    render(
      <FollowHeartButton
        following={false}
        label="Follow"
        loading
        heartTestId="heart"
        onClick={onClick}
      />,
    );
    const button = screen.getByRole("button", { name: "Follow" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("heart")).toHaveClass("animate-spin");
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
