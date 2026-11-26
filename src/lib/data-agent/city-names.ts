import cityNames from "./city-names-2019.json";

// The 2019 administrative names are matched to the study's original six-digit identifiers.
const cities = Object.entries(cityNames);
const baseName = (name: string) => name.trim().replace(/(?:市|地区|自治州|盟)$/u, "");

export function cityCodesForName(search: string) {
  return cities.filter(([, name]) => baseName(name) === baseName(search)).map(([code]) => code);
}

export function cityNameInQuestion(question: string) {
  const found = new Set(cities.map(([, name]) => baseName(name)).filter(name => {
    const position = question.indexOf(name);
    if (position < 0 || name.length < 2) return false;
    return !/^(?:省|自治区|县|区)/u.test(question.slice(position + name.length));
  }));
  return found.size === 1 ? [...found][0] : undefined;
}
