import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeleteAccountButton } from "@/app/admin/users/delete-account-button";

const mockDelete = vi.fn();
const mockRefresh = vi.fn();

vi.mock("@/app/admin/users/actions", () => ({
  deleteAccountPermanentlyAction: (...args: unknown[]) => mockDelete(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const USER_ID = "323e4567-e89b-12d3-a456-426614174000";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DeleteAccountButton", () => {
  it("requires typing ELIMINAR before the confirm button is enabled", async () => {
    const user = userEvent.setup();
    render(<DeleteAccountButton userId={USER_ID} memberName="Ada Lovelace" />);

    await user.click(screen.getByRole("button", { name: /Eliminar permanentemente/ }));

    const confirm = screen.getByRole("button", { name: /Eliminar definitivamente/ });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/ELIMINAR/), "eliminar");
    expect(confirm).toBeEnabled();
  });

  it("does NOT close the dialog while the deletion is pending (escape/overlay ignored)", async () => {
    let resolveDelete: (value: { success: boolean; error?: string }) => void = () => {};
    mockDelete.mockImplementation(
      () =>
        new Promise<{ success: boolean; error?: string }>((resolve) => {
          resolveDelete = resolve;
        }),
    );

    const user = userEvent.setup();
    render(<DeleteAccountButton userId={USER_ID} memberName="Ada Lovelace" />);

    await user.click(screen.getByRole("button", { name: /Eliminar permanentemente/ }));
    await user.type(screen.getByPlaceholderText(/ELIMINAR/), "ELIMINAR");
    await user.click(screen.getByRole("button", { name: /Eliminar definitivamente/ }));

    // The action promise is still pending -> transition is not finished yet
    // (button shows the pending label).
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Eliminando/ })).toBeInTheDocument();
    });

    // Simulate the user pressing Escape / clicking the overlay: even if the
    // dialog asks to close, the pending operation must keep it open.
    await user.keyboard("{Escape}");

    // The dialog (and its title) must still be present.
    expect(screen.getByText(/¿Eliminar la cuenta de Ada Lovelace\?/)).toBeInTheDocument();

    // Resolve the pending action to avoid an unsettled promise.
    resolveDelete({ success: true });
  });

  it("closes the dialog, clears the input and refreshes on success", async () => {
    mockDelete.mockResolvedValue({ success: true });

    const user = userEvent.setup();
    render(<DeleteAccountButton userId={USER_ID} memberName="Ada Lovelace" />);

    await user.click(screen.getByRole("button", { name: /Eliminar permanentemente/ }));
    await user.type(screen.getByPlaceholderText(/ELIMINAR/), "ELIMINAR");
    await user.click(screen.getByRole("button", { name: /Eliminar definitivamente/ }));

    expect(mockDelete).toHaveBeenCalledWith({ userId: USER_ID, confirmation: "ELIMINAR" });

    await waitFor(() => {
      expect(screen.queryByText(/¿Eliminar la cuenta de Ada Lovelace\?/)).not.toBeInTheDocument();
    });
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows the server error and keeps the dialog open on failure", async () => {
    mockDelete.mockResolvedValue({ success: false, error: "Debes escribir ELIMINAR." });

    const user = userEvent.setup();
    render(<DeleteAccountButton userId={USER_ID} memberName="Ada Lovelace" />);

    await user.click(screen.getByRole("button", { name: /Eliminar permanentemente/ }));
    await user.type(screen.getByPlaceholderText(/ELIMINAR/), "ELIMINAR");
    await user.click(screen.getByRole("button", { name: /Eliminar definitivamente/ }));

    await waitFor(() => {
      expect(screen.getByText("Debes escribir ELIMINAR.")).toBeInTheDocument();
    });
    expect(screen.getByText(/¿Eliminar la cuenta de Ada Lovelace\?/)).toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
