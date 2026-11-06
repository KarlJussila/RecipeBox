use std::collections::HashMap;
use std::path::Path;

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};

pub type Result<T> = std::result::Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// A titled group of ingredient lines or instruction steps.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    #[serde(default)]
    pub heading: String,
    #[serde(default)]
    pub items: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Recipe {
    pub id: String,
    pub title: String,
    pub description: String,
    pub source_url: Option<String>,
    pub source_name: Option<String>,
    pub author: Option<String>,
    /// File name inside the images directory.
    pub image: Option<String>,
    pub yields: Option<String>,
    pub prep_minutes: Option<i64>,
    pub cook_minutes: Option<i64>,
    pub total_minutes: Option<i64>,
    pub ingredients: Vec<Section>,
    pub instructions: Vec<Section>,
    /// Notes and tips from the recipe itself ("Do ahead", "Storage", ...), kept apart from the steps.
    pub tips: Vec<Section>,
    /// The cook's own notes.
    pub notes: String,
    pub keywords: Vec<String>,
    pub rating: Option<i64>,
    pub favorite: bool,
    pub tags: Vec<String>,
    /// Set until the LLM has chosen tags (it may have been offline or unconfigured).
    pub needs_tags: bool,
    /// The page the AI read the recipe from, as the frontend's SourcePage; the app only stores it.
    pub source_page: Option<serde_json::Value>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Tag {
    pub name: String,
    pub category: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RecipeSummary {
    pub id: String,
    pub title: String,
    pub description: String,
    pub source_url: Option<String>,
    pub source_name: Option<String>,
    pub image: Option<String>,
    pub total_minutes: Option<i64>,
    pub rating: Option<i64>,
    pub favorite: bool,
    pub tags: Vec<String>,
    pub needs_tags: bool,
    pub created_at: String,
}

const SCHEMA_VERSION: i64 = 3;

/// Tags a new collection starts with. The AI tags recipes only from tags in these
/// categories, so this is its vocabulary until the cook adds her own.
const STARTER_TAGS: &[(&str, &[&str])] = &[
    (
        "Dish",
        &[
            "Main Course", "Side Dish", "Soup", "Stew", "Salad", "Sandwich", "Casserole", "Breakfast", "Appetizer", "Snack",
            "Bread", "Sauce", "Drink", "Dessert", "Cake", "Cookies", "Pie",
        ],
    ),
    (
        "Ingredient",
        &[
            "Poultry", "Red Meat", "Fish", "Seafood", "Pasta", "Rice", "Beans", "Eggs", "Cheese", "Potatoes", "Vegetables",
            "Fruit", "Nuts", "Chocolate",
        ],
    ),
    (
        "Cuisine",
        &[
            "Italian", "Mexican", "French", "Greek", "Spanish", "Middle Eastern", "Indian", "Chinese", "Japanese", "Korean",
            "Thai", "Vietnamese",
        ],
    ),
    ("Dietary", &["Vegetarian", "Vegan", "Gluten-Free", "Dairy-Free"]),
    ("Method", &["Slow Cooker", "Instant Pot", "Air Fryer", "Grilling", "No-Bake"]),
];

pub struct Db {
    conn: Connection,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path).map_err(err)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             PRAGMA synchronous = NORMAL;",
        )
        .map_err(err)?;
        let db = Db { conn };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<()> {
        let version: i64 = self
            .conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(err)?;
        if version < 1 {
            self.conn
                .execute_batch(
                    "CREATE TABLE recipes (
                        id TEXT PRIMARY KEY,
                        title TEXT NOT NULL,
                        description TEXT NOT NULL DEFAULT '',
                        source_url TEXT,
                        source_name TEXT,
                        author TEXT,
                        image TEXT,
                        yields TEXT,
                        prep_minutes INTEGER,
                        cook_minutes INTEGER,
                        total_minutes INTEGER,
                        ingredients TEXT NOT NULL DEFAULT '[]',
                        instructions TEXT NOT NULL DEFAULT '[]',
                        tips TEXT NOT NULL DEFAULT '[]',
                        notes TEXT NOT NULL DEFAULT '',
                        keywords TEXT NOT NULL DEFAULT '[]',
                        rating INTEGER,
                        favorite INTEGER NOT NULL DEFAULT 0,
                        needs_tags INTEGER NOT NULL DEFAULT 0,
                        source_page TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    );
                    CREATE INDEX recipes_source_url ON recipes(source_url);

                    CREATE TABLE tags (
                        id INTEGER PRIMARY KEY,
                        name TEXT NOT NULL UNIQUE COLLATE NOCASE
                    );

                    CREATE TABLE recipe_tags (
                        recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
                        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                        PRIMARY KEY (recipe_id, tag_id)
                    );
                    CREATE INDEX recipe_tags_tag ON recipe_tags(tag_id);

                    -- Keyed by recipes.rowid; kept in sync by index_recipe().
                    CREATE VIRTUAL TABLE recipes_fts USING fts5(
                        title, description, ingredients, instructions, notes, tags,
                        tokenize = 'porter unicode61 remove_diacritics 2',
                        prefix = '2 3'
                    );",
                )
                .map_err(err)?;
        }
        if version < 2 {
            // Groups tags in the sidebar: Dish, Ingredient, Cuisine, ... (see TAG_CATEGORIES in the frontend).
            self.conn
                .execute_batch("ALTER TABLE tags ADD COLUMN category TEXT")
                .map_err(err)?;
        }
        if version < 3 {
            // Tags created on their own, before any recipe uses them, survive pruning.
            self.conn
                .execute_batch("ALTER TABLE tags ADD COLUMN kept INTEGER NOT NULL DEFAULT 0")
                .map_err(err)?;
        }
        if version < 1 {
            for (category, names) in STARTER_TAGS {
                for name in *names {
                    self.create_tag(name, Some(category))?;
                }
            }
        }
        self.conn
            .execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION}"))
            .map_err(err)?;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<RecipeSummary>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT r.id, r.title, r.description, r.source_url, r.source_name, r.image,
                        r.total_minutes, r.rating, r.favorite, r.created_at, r.needs_tags,
                        (SELECT json_group_array(t.name) FROM recipe_tags rt
                           JOIN tags t ON t.id = rt.tag_id WHERE rt.recipe_id = r.id)
                 FROM recipes r
                 ORDER BY r.created_at DESC",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                let tags: String = r.get(11)?;
                Ok(RecipeSummary {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    description: r.get(2)?,
                    source_url: r.get(3)?,
                    source_name: r.get(4)?,
                    image: r.get(5)?,
                    total_minutes: r.get(6)?,
                    rating: r.get(7)?,
                    favorite: r.get(8)?,
                    created_at: r.get(9)?,
                    needs_tags: r.get(10)?,
                    tags: sorted(serde_json::from_str(&tags).unwrap_or_default()),
                })
            })
            .map_err(err)?;
        rows.collect::<rusqlite::Result<_>>().map_err(err)
    }

    pub fn get(&self, id: &str) -> Result<Option<Recipe>> {
        let recipe = self
            .conn
            .query_row(
                "SELECT id, title, description, source_url, source_name, author, image, yields,
                        prep_minutes, cook_minutes, total_minutes, ingredients, instructions,
                        notes, keywords, rating, favorite, created_at, updated_at, needs_tags, tips, source_page
                 FROM recipes WHERE id = ?1",
                [id],
                |r| {
                    let ingredients: String = r.get(11)?;
                    let instructions: String = r.get(12)?;
                    let keywords: String = r.get(14)?;
                    let tips: String = r.get(20)?;
                    let source_page: Option<String> = r.get(21)?;
                    Ok(Recipe {
                        id: r.get(0)?,
                        title: r.get(1)?,
                        description: r.get(2)?,
                        source_url: r.get(3)?,
                        source_name: r.get(4)?,
                        author: r.get(5)?,
                        image: r.get(6)?,
                        yields: r.get(7)?,
                        prep_minutes: r.get(8)?,
                        cook_minutes: r.get(9)?,
                        total_minutes: r.get(10)?,
                        ingredients: serde_json::from_str(&ingredients).unwrap_or_default(),
                        instructions: serde_json::from_str(&instructions).unwrap_or_default(),
                        tips: serde_json::from_str(&tips).unwrap_or_default(),
                        notes: r.get(13)?,
                        keywords: serde_json::from_str(&keywords).unwrap_or_default(),
                        rating: r.get(15)?,
                        favorite: r.get(16)?,
                        tags: Vec::new(),
                        needs_tags: r.get(19)?,
                        source_page: source_page.and_then(|s| serde_json::from_str(&s).ok()),
                        created_at: r.get(17)?,
                        updated_at: r.get(18)?,
                    })
                },
            )
            .optional()
            .map_err(err)?;
        let Some(mut recipe) = recipe else {
            return Ok(None);
        };
        recipe.tags = tags_for(&self.conn, id)?;
        Ok(Some(recipe))
    }

    /// Inserts the recipe, or replaces it if the id already exists.
    /// Returns the previous image file name when it was replaced or removed.
    pub fn save(&mut self, recipe: &mut Recipe) -> Result<Option<String>> {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        if recipe.id.is_empty() {
            recipe.id = uuid::Uuid::new_v4().to_string();
        }
        recipe.title = recipe.title.trim().to_string();
        if recipe.title.is_empty() {
            recipe.title = "Untitled recipe".into();
        }
        recipe.updated_at = now.clone();

        let tx = self.conn.transaction().map_err(err)?;
        let existing: Option<(String, Option<String>)> = tx
            .query_row(
                "SELECT created_at, image FROM recipes WHERE id = ?1",
                [&recipe.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(err)?;
        let old_image = match &existing {
            Some((created_at, old_image)) => {
                recipe.created_at = created_at.clone();
                old_image.clone().filter(|old| Some(old) != recipe.image.as_ref())
            }
            None => {
                if recipe.created_at.is_empty() {
                    recipe.created_at = now;
                }
                None
            }
        };

        tx.execute(
            "INSERT INTO recipes (id, title, description, source_url, source_name, author, image,
                yields, prep_minutes, cook_minutes, total_minutes, ingredients, instructions,
                notes, keywords, rating, favorite, created_at, updated_at, needs_tags, tips, source_page)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)
             ON CONFLICT(id) DO UPDATE SET
                title = excluded.title, description = excluded.description,
                source_url = excluded.source_url, source_name = excluded.source_name,
                author = excluded.author, image = excluded.image, yields = excluded.yields,
                prep_minutes = excluded.prep_minutes, cook_minutes = excluded.cook_minutes,
                total_minutes = excluded.total_minutes, ingredients = excluded.ingredients,
                instructions = excluded.instructions, notes = excluded.notes,
                keywords = excluded.keywords, rating = excluded.rating,
                favorite = excluded.favorite, updated_at = excluded.updated_at,
                needs_tags = excluded.needs_tags, tips = excluded.tips,
                source_page = excluded.source_page",
            params![
                recipe.id,
                recipe.title,
                recipe.description,
                recipe.source_url,
                recipe.source_name,
                recipe.author,
                recipe.image,
                recipe.yields,
                recipe.prep_minutes,
                recipe.cook_minutes,
                recipe.total_minutes,
                serde_json::to_string(&recipe.ingredients).map_err(err)?,
                serde_json::to_string(&recipe.instructions).map_err(err)?,
                recipe.notes,
                serde_json::to_string(&recipe.keywords).map_err(err)?,
                recipe.rating,
                recipe.favorite,
                recipe.created_at,
                recipe.updated_at,
                recipe.needs_tags,
                serde_json::to_string(&recipe.tips).map_err(err)?,
                recipe.source_page.as_ref().map(|page| page.to_string()),
            ],
        )
        .map_err(err)?;

        set_tags(&tx, &recipe.id, &recipe.tags)?;
        recipe.tags = tags_for(&tx, &recipe.id)?;
        index_recipe(&tx, &recipe.id)?;
        tx.commit().map_err(err)?;
        Ok(old_image)
    }

    /// Deletes the recipe and returns its image file name, if any.
    pub fn delete(&mut self, id: &str) -> Result<Option<String>> {
        let tx = self.conn.transaction().map_err(err)?;
        let image: Option<String> = tx
            .query_row("SELECT image FROM recipes WHERE id = ?1", [id], |r| r.get(0))
            .optional()
            .map_err(err)?
            .flatten();
        tx.execute(
            "DELETE FROM recipes_fts WHERE rowid = (SELECT rowid FROM recipes WHERE id = ?1)",
            [id],
        )
        .map_err(err)?;
        tx.execute("DELETE FROM recipes WHERE id = ?1", [id]).map_err(err)?;
        prune_tags(&tx)?;
        tx.commit().map_err(err)?;
        Ok(image)
    }

    pub fn set_favorite(&self, id: &str, favorite: bool) -> Result<()> {
        self.conn
            .execute("UPDATE recipes SET favorite = ?2 WHERE id = ?1", params![id, favorite])
            .map_err(err)?;
        Ok(())
    }

    /// Replaces a recipe's tags. Once tags are set, the recipe no longer needs automatic tagging.
    /// `categories` fills in the category of tags that don't have one yet.
    pub fn set_tags(&mut self, id: &str, tags: &[String], categories: &HashMap<String, String>) -> Result<Vec<String>> {
        let tx = self.conn.transaction().map_err(err)?;
        set_tags(&tx, id, tags)?;
        for (name, category) in categories {
            tx.execute(
                "UPDATE tags SET category = ?2 WHERE name = ?1 AND category IS NULL",
                params![name.trim(), category],
            )
            .map_err(err)?;
        }
        tx.execute("UPDATE recipes SET needs_tags = 0 WHERE id = ?1", [id]).map_err(err)?;
        let tags = tags_for(&tx, id)?;
        index_recipe(&tx, id)?;
        tx.commit().map_err(err)?;
        Ok(tags)
    }

    /// Returns recipe ids matching the query, best match first.
    pub fn search(&self, query: &str) -> Result<Vec<String>> {
        let Some(fts_query) = fts_query(query) else {
            return Ok(Vec::new());
        };
        let mut stmt = self
            .conn
            .prepare(
                "SELECT r.id FROM recipes_fts f JOIN recipes r ON r.rowid = f.rowid
                 WHERE recipes_fts MATCH ?1
                 ORDER BY bm25(recipes_fts, 10.0, 2.0, 4.0, 1.0, 2.0, 6.0)",
            )
            .map_err(err)?;
        let rows = stmt.query_map([fts_query], |r| r.get(0)).map_err(err)?;
        rows.collect::<rusqlite::Result<_>>().map_err(err)
    }

    pub fn find_by_source_url(&self, url: &str) -> Result<Option<String>> {
        self.conn
            .query_row(
                "SELECT id FROM recipes WHERE source_url = ?1 ORDER BY created_at LIMIT 1",
                [url],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)
    }

    pub fn all_tags(&self) -> Result<Vec<Tag>> {
        let mut stmt = self
            .conn
            .prepare("SELECT name, category FROM tags ORDER BY name COLLATE NOCASE")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| Ok(Tag { name: r.get(0)?, category: r.get(1)? }))
            .map_err(err)?;
        rows.collect::<rusqlite::Result<_>>().map_err(err)
    }

    /// Adds a tag that stays until deleted, even while no recipe uses it.
    pub fn create_tag(&self, name: &str, category: Option<&str>) -> Result<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err("Tag name can't be empty".into());
        }
        self.conn
            .execute(
                "INSERT INTO tags (name, category, kept) VALUES (?1, ?2, 1)
                 ON CONFLICT (name) DO UPDATE SET kept = 1, category = coalesce(?2, category)",
                params![name, category],
            )
            .map_err(err)?;
        Ok(())
    }

    pub fn set_tag_category(&self, name: &str, category: Option<&str>) -> Result<()> {
        self.conn
            .execute("UPDATE tags SET category = ?2 WHERE name = ?1", params![name, category])
            .map_err(err)?;
        Ok(())
    }

    /// Renames a tag. If another tag already has the new name, the two are merged.
    pub fn rename_tag(&mut self, from: &str, to: &str) -> Result<()> {
        let to = to.trim();
        if to.is_empty() {
            return Err("Tag name can't be empty".into());
        }
        let tx = self.conn.transaction().map_err(err)?;
        let from_id: Option<i64> = tx
            .query_row("SELECT id FROM tags WHERE name = ?1", [from], |r| r.get(0))
            .optional()
            .map_err(err)?;
        let Some(from_id) = from_id else {
            return Ok(());
        };
        let to_id: Option<i64> = tx
            .query_row("SELECT id FROM tags WHERE name = ?1", [to], |r| r.get(0))
            .optional()
            .map_err(err)?;
        let affected = recipes_with_tag(&tx, from_id)?;
        match to_id {
            Some(to_id) if to_id != from_id => {
                tx.execute(
                    "INSERT OR IGNORE INTO recipe_tags (recipe_id, tag_id)
                     SELECT recipe_id, ?2 FROM recipe_tags WHERE tag_id = ?1",
                    params![from_id, to_id],
                )
                .map_err(err)?;
                tx.execute(
                    "UPDATE tags SET kept = max(kept, (SELECT kept FROM tags WHERE id = ?1)) WHERE id = ?2",
                    params![from_id, to_id],
                )
                .map_err(err)?;
                tx.execute("DELETE FROM tags WHERE id = ?1", [from_id]).map_err(err)?;
            }
            // Same tag (possibly a change of capitalization) or a brand new name.
            _ => {
                tx.execute("UPDATE tags SET name = ?2 WHERE id = ?1", params![from_id, to])
                    .map_err(err)?;
            }
        }
        for id in affected {
            index_recipe(&tx, &id)?;
        }
        tx.commit().map_err(err)
    }

    pub fn delete_tag(&mut self, name: &str) -> Result<()> {
        let tx = self.conn.transaction().map_err(err)?;
        let tag_id: Option<i64> = tx
            .query_row("SELECT id FROM tags WHERE name = ?1", [name], |r| r.get(0))
            .optional()
            .map_err(err)?;
        if let Some(tag_id) = tag_id {
            let affected = recipes_with_tag(&tx, tag_id)?;
            tx.execute("DELETE FROM tags WHERE id = ?1", [tag_id]).map_err(err)?;
            for id in affected {
                index_recipe(&tx, &id)?;
            }
        }
        tx.commit().map_err(err)
    }

    /// Writes a consistent snapshot of the database to `dest`.
    pub fn backup_to(&self, dest: &Path) -> Result<()> {
        if dest.exists() {
            std::fs::remove_file(dest).map_err(err)?;
        }
        self.conn
            .execute("VACUUM INTO ?1", [dest.to_string_lossy()])
            .map_err(err)?;
        Ok(())
    }

    pub fn image_files(&self) -> Result<Vec<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT image FROM recipes WHERE image IS NOT NULL")
            .map_err(err)?;
        let rows = stmt.query_map([], |r| r.get(0)).map_err(err)?;
        rows.collect::<rusqlite::Result<_>>().map_err(err)
    }
}

fn sorted(mut tags: Vec<String>) -> Vec<String> {
    tags.sort_by_key(|t| t.to_lowercase());
    tags
}

fn tags_for(conn: &Connection, recipe_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn
        .prepare(
            "SELECT t.name FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id
             WHERE rt.recipe_id = ?1 ORDER BY t.name COLLATE NOCASE",
        )
        .map_err(err)?;
    let rows = stmt.query_map([recipe_id], |r| r.get(0)).map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

fn recipes_with_tag(conn: &Connection, tag_id: i64) -> Result<Vec<String>> {
    let mut stmt = conn
        .prepare("SELECT recipe_id FROM recipe_tags WHERE tag_id = ?1")
        .map_err(err)?;
    let rows = stmt.query_map([tag_id], |r| r.get(0)).map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

fn set_tags(tx: &Transaction, recipe_id: &str, tags: &[String]) -> Result<()> {
    tx.execute("DELETE FROM recipe_tags WHERE recipe_id = ?1", [recipe_id])
        .map_err(err)?;
    for tag in tags {
        let tag = tag.trim();
        if tag.is_empty() {
            continue;
        }
        tx.execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", [tag])
            .map_err(err)?;
        tx.execute(
            "INSERT OR IGNORE INTO recipe_tags (recipe_id, tag_id)
             SELECT ?1, id FROM tags WHERE name = ?2",
            params![recipe_id, tag],
        )
        .map_err(err)?;
    }
    prune_tags(tx)
}

/// Tags only exist while at least one recipe uses them, unless created on their own.
fn prune_tags(tx: &Transaction) -> Result<()> {
    tx.execute(
        "DELETE FROM tags WHERE kept = 0 AND id NOT IN (SELECT DISTINCT tag_id FROM recipe_tags)",
        [],
    )
    .map_err(err)?;
    Ok(())
}

fn index_recipe(tx: &Transaction, recipe_id: &str) -> Result<()> {
    let row: Option<(i64, String, String, String, String, String, String, String)> = tx
        .query_row(
            "SELECT rowid, title, description, ingredients, instructions, tips, notes, keywords
             FROM recipes WHERE id = ?1",
            [recipe_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?)),
        )
        .optional()
        .map_err(err)?;
    let Some((rowid, title, description, ingredients, instructions, tips, notes, keywords)) = row else {
        return Ok(());
    };
    let flatten = |json: &str| {
        let sections: Vec<Section> = serde_json::from_str(json).unwrap_or_default();
        sections
            .into_iter()
            .flat_map(|s| std::iter::once(s.heading).chain(s.items))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let keywords: Vec<String> = serde_json::from_str(&keywords).unwrap_or_default();
    let mut tags = tags_for(tx, recipe_id)?;
    tags.extend(keywords);

    tx.execute("DELETE FROM recipes_fts WHERE rowid = ?1", [rowid])
        .map_err(err)?;
    tx.execute(
        "INSERT INTO recipes_fts (rowid, title, description, ingredients, instructions, notes, tags)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            rowid,
            title,
            description,
            flatten(&ingredients),
            // Tips share the steps' column so the index's layout doesn't change.
            [flatten(&instructions), flatten(&tips)].join("\n"),
            notes,
            tags.join("\n")
        ],
    )
    .map_err(err)?;
    Ok(())
}

/// Turns free text into an FTS5 query where every word must match as a prefix.
fn fts_query(input: &str) -> Option<String> {
    let terms: Vec<String> = input
        .split(|c: char| !c.is_alphanumeric() && c != '\'')
        .map(|t| t.trim_matches('\''))
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{}\"*", t.replace('"', "")))
        .collect();
    (!terms.is_empty()).then(|| terms.join(" "))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn new_db() -> Db {
        let path = std::env::temp_dir().join(format!("recipebox-test-{}.db", uuid::Uuid::new_v4()));
        Db::open(&path).unwrap()
    }

    /// A database without the starter tags, so tests see only the tags they make.
    fn temp_db() -> Db {
        let db = new_db();
        db.conn.execute("DELETE FROM tags", []).unwrap();
        db
    }

    fn recipe(title: &str, tags: &[&str]) -> Recipe {
        Recipe {
            title: title.into(),
            ingredients: vec![Section {
                heading: String::new(),
                items: vec!["2 cups chickpeas".into(), "1 lemon".into()],
            }],
            tags: tags.iter().map(|t| t.to_string()).collect(),
            ..Default::default()
        }
    }

    #[test]
    fn save_search_and_tags() {
        let mut db = temp_db();
        let mut a = recipe("Lemony Hummus", &["Dips", "vegetarian"]);
        db.save(&mut a).unwrap();
        let mut b = recipe("Roast Chicken", &["Dinner", "Vegetarian"]);
        db.save(&mut b).unwrap();

        // Tag names are case-insensitive and keep the first spelling.
        let names = |db: &Db| db.all_tags().unwrap().into_iter().map(|t| t.name).collect::<Vec<_>>();
        assert_eq!(names(&db), vec!["Dinner", "Dips", "vegetarian"]);
        assert_eq!(db.search("chick").unwrap().len(), 2);
        assert_eq!(db.search("hummus lemon").unwrap(), vec![a.id.clone()]);
        assert_eq!(db.search("dips").unwrap(), vec![a.id.clone()]);

        db.rename_tag("Dips", "Dinner").unwrap();
        assert_eq!(db.get(&a.id).unwrap().unwrap().tags, vec!["Dinner", "vegetarian"]);
        assert_eq!(db.search("dinner").unwrap().len(), 2);

        db.delete(&b.id).unwrap();
        db.delete_tag("vegetarian").unwrap();
        assert_eq!(names(&db), vec!["Dinner"]);
        assert_eq!(db.list().unwrap().len(), 1);
    }

    #[test]
    fn tag_categories_fill_in_but_do_not_overwrite() {
        let mut db = temp_db();
        let mut r = recipe("Soup", &[]);
        db.save(&mut r).unwrap();
        let tags = vec!["Soup".to_string(), "Beans".to_string()];
        let first = HashMap::from([("Soup".to_string(), "Dish".to_string())]);
        db.set_tags(&r.id, &tags, &first).unwrap();
        let second = HashMap::from([
            ("Soup".to_string(), "Other".to_string()),
            ("Beans".to_string(), "Ingredient".to_string()),
        ]);
        db.set_tags(&r.id, &tags, &second).unwrap();
        assert_eq!(
            db.all_tags().unwrap(),
            vec![
                Tag { name: "Beans".into(), category: Some("Ingredient".into()) },
                Tag { name: "Soup".into(), category: Some("Dish".into()) },
            ]
        );
    }

    #[test]
    fn new_collections_start_with_starter_tags() {
        let mut db = new_db();
        let mut r = recipe("Soup", &[]);
        db.save(&mut r).unwrap();
        db.set_tags(&r.id, &[], &HashMap::new()).unwrap();
        let tags = db.all_tags().unwrap();
        assert_eq!(tags.len(), STARTER_TAGS.iter().map(|(_, names)| names.len()).sum::<usize>());
        assert!(tags.contains(&Tag { name: "Slow Cooker".into(), category: Some("Method".into()) }));
    }

    #[test]
    fn created_tags_survive_pruning() {
        let mut db = temp_db();
        db.create_tag("Thanksgiving", Some("Occasion")).unwrap();
        let mut r = recipe("Soup", &[]);
        db.save(&mut r).unwrap();
        db.set_tags(&r.id, &["Soup".to_string()], &HashMap::new()).unwrap();
        db.set_tags(&r.id, &[], &HashMap::new()).unwrap();
        assert_eq!(db.all_tags().unwrap(), vec![Tag { name: "Thanksgiving".into(), category: Some("Occasion".into()) }]);
    }

    #[test]
    fn update_keeps_created_at_and_reports_old_image() {
        let mut db = temp_db();
        let mut r = recipe("Soup", &[]);
        r.image = Some("a.jpg".into());
        db.save(&mut r).unwrap();
        let created = r.created_at.clone();
        r.image = Some("b.jpg".into());
        r.created_at = String::new();
        assert_eq!(db.save(&mut r).unwrap(), Some("a.jpg".into()));
        assert_eq!(r.created_at, created);
    }

    #[test]
    fn tips_are_saved_and_searched() {
        let mut db = temp_db();
        let mut r = recipe("Apple Cake", &[]);
        r.tips = vec![Section { heading: "Do ahead".into(), items: vec!["Wrap in foil overnight.".into()] }];
        db.save(&mut r).unwrap();
        assert_eq!(db.get(&r.id).unwrap().unwrap().tips[0].items, vec!["Wrap in foil overnight."]);
        assert_eq!(db.search("foil").unwrap(), vec![r.id.clone()]);
    }

    #[test]
    fn source_page_is_kept_as_saved() {
        let mut db = temp_db();
        let mut r = recipe("Apple Cake", &[]);
        db.save(&mut r).unwrap();
        assert_eq!(db.get(&r.id).unwrap().unwrap().source_page, None);
        let page = serde_json::json!({ "lines": ["Apple Cake", "- 2 apples"], "parts": [null, "ingredient"], });
        r.source_page = Some(page.clone());
        db.save(&mut r).unwrap();
        assert_eq!(db.get(&r.id).unwrap().unwrap().source_page, Some(page));
    }

    #[test]
    fn fts_query_escapes_input() {
        assert_eq!(fts_query("  "), None);
        assert_eq!(fts_query("mom's \"best\" pie"), Some("\"mom's\"* \"best\"* \"pie\"*".into()));
    }
}
