import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShiftMemberSearch } from "@/app/events/[id]/shift-member-search";
import type { ShiftMemberSearchPage } from "@/lib/shifts/search";

const mockSearchAction = vi.fn();
const mockMarkAttendance = vi.fn();
const mockRefresh = vi.fn();

vi.mock("@/app/events/[id]/shift-member-search-actions", () => ({
  searchShiftMembersAction: (...args: unknown[]) => mockSearchAction(...args),
}));

vi.mock("@/app/events/[id]/workgroup-actions", () => ({
  markWorkgroupAttendanceAction: (...args: unknown[]) => mockMarkAttendance(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const SHIFT_ID = "123e4567-e89b-12d3-a456-426614174000";
const U1 = "223e4567-e89b-12d3-a456-426614174000";
const U2 = "323e4567-e89b-12d3-a456-426614174000";

function pageWith(rows: ShiftMemberSearchPage["rows"], extra: Partial<ShiftMemberSearchPage> = {}): ShiftMemberSearchPage {
  return { rows, total: rows.length, page: 1, pageSize: 20, hasMore: false, ...extra };
}

const telasRow = {
  userId: U1,
  firstName: "Ana",
  lastName: "García",
  workgroup: "telas" as const,
  attended: true as const,
};

const barraRow = {
  userId: U2,
  firstName: "Bruno",
  lastName: "López",
  workgroup: "barra" as const,
  attended: null as unknown as boolean | null,
};

function renderSearch(manageableWorkgroups = ["telas", "barra", "estandarte", "limpieza"] as Array<"telas" | "barra" | "estandarte" | "limpieza">) {
  return render(<ShiftMemberSearch shiftId={SHIFT_ID} manageableWorkgroups={manageableWorkgroups} />);
}

/**
 * The native <select> filter also has implicit role "combobox", so every
 * lookup of the search input must be disambiguated by accessible name.
 */
function getSearchCombobox() {
  return screen.getByRole("combobox", { name: /Buscar miembros asignados al turno/ });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

async function searchAndWaitForResults(
  term: string,
  resultPage: ShiftMemberSearchPage,
): Promise<void> {
  mockSearchAction.mockResolvedValue({ success: true, data: resultPage });
  renderSearch();

  const user = userEvent.setup();
  await user.type(getSearchCombobox(), term);

  await waitFor(() => expect(mockSearchAction).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.getByRole("listbox")).toBeInTheDocument(),
  );
}

describe("ShiftMemberSearch — debounce", () => {
  it("debounces the query by ~300 ms and resets the window on new keystrokes", async () => {
    vi.useFakeTimers();
    mockSearchAction.mockResolvedValue({
      success: true,
      data: pageWith([{ ...telasRow }]),
    });

    renderSearch();
    const input = getSearchCombobox();

    // First keystroke starts the debounce window…
    fireEvent.change(input, { target: { value: "a" } });
    expect(mockSearchAction).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    // …a second keystroke resets it (clearTimeout on cleanup).
    fireEvent.change(input, { target: { value: "ana" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(mockSearchAction).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    // NOTE: no waitFor here — testing-library polling relies on real
    // timers, which are frozen under vi.useFakeTimers().
    expect(mockSearchAction).toHaveBeenCalledTimes(1);
    expect(mockSearchAction).toHaveBeenCalledWith({
      shiftId: SHIFT_ID,
      query: "ana",
      workgroup: null,
      page: 1,
    });
  });
});

describe("ShiftMemberSearch — results rendering", () => {
  it("renders name, workgroup badge and attendance state per row", async () => {
    await searchAndWaitForResults(
      "a",
      pageWith([
        { ...telasRow },
        { ...barraRow },
      ]),
    );

    expect(screen.getByText(/Ana García/)).toBeInTheDocument();
    expect(screen.getByText(/Bruno López/)).toBeInTheDocument();

    // Scope badge assertions to the listbox: the workgroup filter's
    // <option> elements contain the same texts.
    const listbox = screen.getByRole("listbox");
    expect(within(listbox).getByText("Telas")).toBeInTheDocument();
    expect(within(listbox).getByText("Barra")).toBeInTheDocument();
    expect(within(listbox).getByText("Presente")).toBeInTheDocument();
    expect(within(listbox).getByText("Sin marcar")).toBeInTheDocument();
  });

  it("announces the result count through a polite live region", async () => {
    await searchAndWaitForResults("a", pageWith([{ ...telasRow }, { ...barraRow }], { total: 12 }));

    const liveRegion = screen.getByRole("status");
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
    expect(liveRegion).toHaveTextContent("12 resultados");
  });

  it("starts blank without calling the action until the user types", () => {
    renderSearch();

    expect(mockSearchAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("ShiftMemberSearch — attendance toggling", () => {
  it("toggles a non-barra member through markWorkgroupAttendanceAction and refreshes on success", async () => {
    mockMarkAttendance.mockResolvedValue({ success: true });
    await searchAndWaitForResults("a", pageWith([{ ...telasRow, attended: true }]));

    const checkbox = screen.getByRole("checkbox", { name: /Cambiar asistencia de Ana García/ });
    const user = userEvent.setup();
    await user.click(checkbox);

    await waitFor(() =>
      expect(mockMarkAttendance).toHaveBeenCalledWith({
        shiftId: SHIFT_ID,
        userId: U1,
        workgroup: "telas",
        attended: false,
        hoursWorked: null,
        barraTask: null,
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("rolls back the optimistic toggle and shows the server error on failure", async () => {
    mockMarkAttendance.mockResolvedValue({
      success: false,
      error: "No puedes marcar asistencia para un grupo que no es el tuyo.",
    });
    await searchAndWaitForResults("a", pageWith([{ ...telasRow, attended: true }]));

    const checkbox = screen.getByRole("checkbox", { name: /Cambiar asistencia de Ana García/ });
    const user = userEvent.setup();
    await user.click(checkbox);

    await waitFor(() =>
      expect(
        screen.getByText("No puedes marcar asistencia para un grupo que no es el tuyo."),
      ).toBeInTheDocument(),
    );
    // Rollback: the row returns to its pre-click attendance state.
    expect(checkbox).toBeChecked();
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

describe("ShiftMemberSearch — barra special case", () => {
  it("requires choosing a barra task before saving", async () => {
    await searchAndWaitForResults("bruno", pageWith([{ ...barraRow }]));

    const saveButton = screen.getByRole("button", { name: /Marcar presente a Bruno López/ });
    expect(saveButton).toBeDisabled();

    const cocinaRadio = screen.getByRole("radio", { name: "Cocina" });
    fireEvent.click(cocinaRadio);
    expect(saveButton).toBeEnabled();
  });

  it("sends attended=true with the chosen barraTask when saving", async () => {
    mockMarkAttendance.mockResolvedValue({ success: true });
    await searchAndWaitForResults("bruno", pageWith([{ ...barraRow }]));

    fireEvent.click(screen.getByRole("radio", { name: "Bebidas" }));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Marcar presente a Bruno López/ }));

    await waitFor(() =>
      expect(mockMarkAttendance).toHaveBeenCalledWith({
        shiftId: SHIFT_ID,
        userId: U2,
        workgroup: "barra",
        attended: true,
        hoursWorked: null,
        barraTask: "bebidas",
      }),
    );
  });
});

describe("ShiftMemberSearch — keyboard navigation", () => {
  it("moves the highlight with ArrowDown and marks with Enter, clears with Escape", async () => {
    mockMarkAttendance.mockResolvedValue({ success: true });
    await searchAndWaitForResults("a", pageWith([{ ...telasRow }]));

    const combobox = getSearchCombobox();
    expect(combobox).toHaveAttribute("aria-expanded", "true");
    expect(combobox).toHaveAttribute("aria-autocomplete", "list");
    expect(combobox.getAttribute("aria-controls")).toBeTruthy();

    // Scope to the listbox: the filter's native <option>s also carry
    // the implicit "option" role.
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveAttribute("aria-selected", "false");

    fireEvent.keyDown(combobox, { key: "ArrowDown" });
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(combobox, { key: "Enter" });
    await waitFor(() => expect(mockMarkAttendance).toHaveBeenCalled());

    fireEvent.keyDown(combobox, { key: "Escape" });
    await waitFor(() => {
      expect(combobox).toHaveValue("");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
  });
});

describe("ShiftMemberSearch — pagination", () => {
  it("disables Siguiente when there are no more pages and requests the next page otherwise", async () => {
    await searchAndWaitForResults(
      "a",
      pageWith([{ ...telasRow }], { hasMore: true }),
    );

    const prev = screen.getByRole("button", { name: "Anterior" });
    const next = screen.getByRole("button", { name: "Siguiente" });
    expect(prev).toBeDisabled();
    expect(next).toBeEnabled();

    const user = userEvent.setup();
    await user.click(next);

    await waitFor(() =>
      expect(mockSearchAction).toHaveBeenCalledWith(
        expect.objectContaining({ query: "a", page: 2 }),
      ),
    );
  });
});
