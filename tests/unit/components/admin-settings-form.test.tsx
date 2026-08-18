import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsForm } from "@/app/admin/settings/settings-form";
import type { SettingsItem } from "@/lib/admin/schema";

// ── Mocks (UI-focused: the server action is scripted) ──

const mockUpdateSetting = vi.fn();

vi.mock("@/app/admin/actions", () => ({
  updateSettingAction: (...args: unknown[]) => mockUpdateSetting(...args),
}));

function makeSettings(): SettingsItem[] {
  return [
    {
      key: "app_name",
      value: "Umsuka Imbali",
      updatedBy: "123e4567-e89b-12d3-a456-426614174000",
      updatedAt: "2026-08-18T10:00:00.000Z",
    },
    {
      key: "instagram_url",
      value: "https://instagram.com/umsuka_imbali",
      updatedBy: null,
      updatedAt: "2026-08-18T10:00:00.000Z",
    },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SettingsForm", () => {
  it("renders every setting with its current value", () => {
    render(<SettingsForm initialSettings={makeSettings()} />);

    expect(screen.getByLabelText(/Nombre de la asociación/)).toHaveValue("Umsuka Imbali");
    expect(screen.getByLabelText(/URL de Instagram/)).toHaveValue(
      "https://instagram.com/umsuka_imbali",
    );
    expect(screen.getByRole("button", { name: /Guardar cambios/ })).toBeInTheDocument();
  });

  it("submits the edited app_name through the server action and reports success", async () => {
    const user = userEvent.setup();
    mockUpdateSetting.mockResolvedValue({ success: true });
    render(<SettingsForm initialSettings={makeSettings()} />);

    const appNameInput = screen.getByLabelText(/Nombre de la asociación/);
    await user.clear(appNameInput);
    await user.type(appNameInput, "Umsuka Imbali 2");

    await user.click(screen.getByRole("button", { name: /Guardar cambios/ }));

    await waitFor(() => {
      expect(mockUpdateSetting).toHaveBeenCalledWith({
        key: "app_name",
        value: "Umsuka Imbali 2",
      });
    });
    expect(screen.getByText(/Configuración guardada/)).toBeInTheDocument();
  });

  it("submits the edited instagram_url through the server action", async () => {
    const user = userEvent.setup();
    mockUpdateSetting.mockResolvedValue({ success: true });
    render(<SettingsForm initialSettings={makeSettings()} />);

    const urlInput = screen.getByLabelText(/URL de Instagram/);
    await user.clear(urlInput);
    await user.type(urlInput, "https://instagram.com/umsuka");

    await user.click(screen.getByRole("button", { name: /Guardar cambios/ }));

    await waitFor(() => {
      expect(mockUpdateSetting).toHaveBeenCalledWith({
        key: "instagram_url",
        value: "https://instagram.com/umsuka",
      });
    });
  });

  it("shows the server error message when the action fails", async () => {
    const user = userEvent.setup();
    mockUpdateSetting.mockResolvedValue({ success: false, error: "No tienes permisos." });
    render(<SettingsForm initialSettings={makeSettings()} />);

    const appNameInput = screen.getByLabelText(/Nombre de la asociación/);
    await user.clear(appNameInput);
    await user.type(appNameInput, "Otra");

    await user.click(screen.getByRole("button", { name: /Guardar cambios/ }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("No tienes permisos.");
    });
  });

  it("does not submit when app_name is cleared (empty value)", async () => {
    const user = userEvent.setup();
    render(<SettingsForm initialSettings={makeSettings()} />);

    const appNameInput = screen.getByLabelText(/Nombre de la asociación/);
    await user.clear(appNameInput);

    await user.click(screen.getByRole("button", { name: /Guardar cambios/ }));

    await waitFor(() => {
      expect(mockUpdateSetting).not.toHaveBeenCalled();
    });
  });

  it("clears the saved message when the user edits a field again", async () => {
    const user = userEvent.setup();
    mockUpdateSetting.mockResolvedValue({ success: true });
    render(<SettingsForm initialSettings={makeSettings()} />);

    const appNameInput = screen.getByLabelText(/Nombre de la asociación/);
    await user.clear(appNameInput);
    await user.type(appNameInput, "Umsuka 3");
    await user.click(screen.getByRole("button", { name: /Guardar cambios/ }));

    await waitFor(() => {
      expect(screen.getByText(/Configuración guardada/)).toBeInTheDocument();
    });

    await user.clear(appNameInput);
    expect(screen.queryByText(/Configuración guardada/)).not.toBeInTheDocument();
  });
});