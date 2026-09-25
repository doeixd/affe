import { Element, StyledComposables } from "@doeixd/affe";

const UserPicker = StyledComposables.createStyledCombobox<string>({
  filter: (item, query) => item.toLowerCase().includes(query.toLowerCase()),
  multiple: true,
});

const users = ["Ada Lovelace", "Grace Hopper", "Margaret Hamilton", "Joan Clarke"] as const;

export function App() {
  return (
    <main style="font-family: ui-sans-serif, system-ui; padding: 16px; max-width: 640px; margin: 0 auto;">
      <h1>Styled Combobox (Headless + Style.attach)</h1>
      <p>This example uses `createStyledCombobox` and renders with a custom view.</p>
      {/*
        `Element.ref(handle, slot)` binds a headless handle to the element it
        names: attached styles and behavior attributes (aria-expanded,
        aria-selected, ...) land on the element, and DOM events reach the
        behavior's listeners (`press` = click, plus Enter/Space where the
        element has no native activation).
      */}

      <UserPicker items={users}>
        {(cb) => (
          <section>
            <p>
              <button ref={Element.ref(cb.trigger, "trigger")}>Toggle</button>
              <button onClick={() => cb.clearSelection()}>Clear Selection</button>
            </p>

            <p>
              <input
                ref={Element.ref(cb.input, "input")}
                value={cb.query()}
                // The combobox reads the query as a string payload, so the
                // value is forwarded explicitly; keydown arrives through the
                // bound handle.
                onInput={(e) => cb.input.emit("input", (e.currentTarget as HTMLInputElement).value)}
                placeholder="Search users"
              />
            </p>

            {cb.isOpen() && (
              <ul ref={Element.ref(cb.content, "content")}>
                {cb.filtered().map((item, index) => {
                  const option = cb.getOptionHandle(index);
                  return (
                    <li key={item}>
                      <button
                        ref={Element.ref(option, "option")}
                        style={cb.isSelected(item) ? "font-weight:700" : "font-weight:400"}
                      >
                        {item}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <p>Selected: {cb.selected().join(", ") || "(none)"}</p>
          </section>
        )}
      </UserPicker>
    </main>
  );
}
