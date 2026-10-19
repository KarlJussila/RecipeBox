import { expect, test } from "vitest";
import { splitAmount } from "./ingredients";
import { headlineCase } from "./extract/text";

test.each([
  ["2 cups flour", "2 cups", " flour"],
  ["1 ½ teaspoons baking powder", "1 ½ teaspoons", " baking powder"],
  ["1 1/2 cups (360 grams) flour", "1 1/2 cups", " (360 grams) flour"],
  ["1 (28-ounce; 800g) can tomatoes", "1 (28-ounce; 800g) can", " tomatoes"],
  ["2 to 3 tablespoons butter", "2 to 3 tablespoons", " butter"],
  ["½ cup sugar", "½ cup", " sugar"],
  ["4 large eggs", "4", " large eggs"],
  ["Kosher salt", "", "Kosher salt"],
  ["About 2 cups water", "About 2 cups", " water"],
  ["1/2 pound (225g) chicken livers", "1/2 pound", " (225g) chicken livers"],
  ["3/4 cup milk", "3/4 cup", " milk"],
])("%s", (line, amount, rest) => {
  expect(splitAmount(line)).toEqual([amount, rest]);
});

test("headline case for lowercase blog titles", () => {
  expect(headlineCase("mom's apple cake")).toBe("Mom's Apple Cake");
  expect(headlineCase("tomato sauce with onion and butter")).toBe("Tomato Sauce with Onion and Butter");
  expect(headlineCase("the best pancakes")).toBe("The Best Pancakes");
});
