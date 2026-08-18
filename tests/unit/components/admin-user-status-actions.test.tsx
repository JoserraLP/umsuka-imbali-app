import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserStatusActions } from "@/app/admin/users/user-status-actions";

const mockApprove = vi.fn();
const mockSuspend = vi.fn();
const mockRefresh = vi.fn();

vi.mock("@/app/admin/actions", () => ({
  approveUserActionAdmin: (...args: unknown[]) => mockApprove(...args),
  suspendUserActionAdmin: (...args: unknown[]) => mockSuspend(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const USER_ID = "323e4567-e89b-12d3-a456-426614174000";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("UserStatusActions", () => {
  it("renders Approve + Suspend for a pending member", () => {
    render(<UserStatusActions userId={USER_ID} status="pending" disableSelf={false} />);

    expect(screen.getByRole("button", { name: /Aprobar/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Suspender/ })).toBeInTheDocument();
  });

  it("renders only Suspend for an active member", () => {
    render(<UserStatusActions userId={USER_ID} status="active" disableSelf={false} />);

    expect(screen.queryByRole("button", { name: /Aprobar/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Suspender/ })).toBeInTheDocument();
  });

  it("renders no buttons for a suspended member", () => {
    render(<UserStatusActions userId={USER_ID} status="suspended" disableSelf={false} />);

    expect(screen.queryByRole("button", { name: /Aprobar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Suspender/ })).not.toBeInTheDocument();
  });

  it("approves through the admin action and refreshes on success", async () => {
    const user = userEvent.setup();
    mockApprove.mockResolvedValue({ success: true });

    render(<UserStatusActions userId={USER_ID} status="pending" disableSelf={false} />);

    await user.click(screen.getByRole("button", { name: /Aprobar/ }));

    expect(mockApprove).toHaveBeenCalledWith({ userId: USER_ID });
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("suspends through the admin action and refreshes on success", async () => {
    const user = userEvent.setup();
    mockSuspend.mockResolvedValue({ success: true });

    render(<UserStatusActions userId={USER_ID} status="active" disableSelf={false} />);

    await user.click(screen.getByRole("button", { name: /Suspender/ }));

    expect(mockSuspend).toHaveBeenCalledWith({ userId: USER_ID });
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows the server error and does not refresh on failure", async () => {
    const user = userEvent.setup();
    mockApprove.mockResolvedValue({ success: false, error: "No puedes aprobarte a ti mismo." });

    render(<UserStatusActions userId={USER_ID} status="pending" disableSelf={false} />);

    await user.click(screen.getByRole("button", { name: /Aprobar/ }));

    expect(screen.getByText("No puedes aprobarte a ti mismo.")).toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("disables the actions for the caller's own row", () => {
    render(<UserStatusActions userId={USER_ID} status="active" disableSelf={true} />);

    expect(screen.getByRole("button", { name: /Suspender/ })).toBeDisabled();
    expect(screen.getByText(/No puedes/)).toBeInTheDocument();
  });
});