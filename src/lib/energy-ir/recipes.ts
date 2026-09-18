import type { EnergyIR } from "./schema";

type Recipe = {
  id: string;
  version: string;
  reviewStatus: "reviewed";
  label: string;
  replaceable: Array<"province" | "technology">;
  ir: EnergyIR;
};

const recipes: Recipe[] = [{
  id: "mapped-solar-assets-by-province",
  version: "1.0.0",
  reviewStatus: "reviewed",
  label: "省级映射光伏设施数量",
  replaceable: ["province"],
  ir: {
    schemaVersion: 1, operation: "read", intent: "mapped_asset_count", metric: "mapped_asset_count",
    entities: { country: "CN", technology: "solar" }, time: { mode: "none" }, groupBy: [], visualization: "number", availabilityRequired: true,
  },
}];

export function instantiateRecipe(id: string, parameters: { province?: string; technology?: EnergyIR["entities"]["technology"] }) {
  const recipe = recipes.find((item) => item.id === id);
  if (!recipe) throw new Error(`Unknown reviewed recipe: ${id}`);
  const entities = { ...recipe.ir.entities };
  for (const key of recipe.replaceable) if (parameters[key]) Object.assign(entities, { [key]: parameters[key] });
  return { recipeId: recipe.id, recipeVersion: recipe.version, ir: { ...recipe.ir, entities } };
}

export const reviewedRecipes = Object.freeze(recipes);
