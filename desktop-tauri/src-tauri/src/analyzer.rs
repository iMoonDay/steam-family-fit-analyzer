use crate::{
    models::{
        AnalysisReport, FamilyLibrary, PriceInfo, ReportGame, ReportGameLists, ReportGamePrices,
        TargetProfile,
    },
    steam::StoreItemEnrichment,
};
use std::collections::{BTreeMap, HashMap, HashSet};

pub fn build_analysis_report(
    targets: Vec<TargetProfile>,
    current_owned_appids: &[String],
    family_library: Option<&FamilyLibrary>,
    warnings: Vec<String>,
) -> AnalysisReport {
    let games = build_report_game_lists(&targets, current_owned_appids, family_library);
    AnalysisReport {
        target_count: targets.len(),
        total_public_games: targets.iter().map(|target| target.game_count).sum(),
        family_game_count: family_library
            .map(|library| library.games_by_id.len())
            .unwrap_or(0),
        new_game_count: games.new.len(),
        overlap_count: games.overlap.len(),
        current_owned_overlap_count: games.current_owned.len(),
        targets,
        games,
        warnings,
    }
}

pub fn apply_store_enrichment_to_report(
    report: &mut AnalysisReport,
    enrichment: &HashMap<String, StoreItemEnrichment>,
) {
    apply_store_enrichment_to_games(&mut report.games.all, enrichment);
    apply_store_enrichment_to_games(&mut report.games.new, enrichment);
    apply_store_enrichment_to_games(&mut report.games.relative_new, enrichment);
    apply_store_enrichment_to_games(&mut report.games.overlap, enrichment);
    apply_store_enrichment_to_games(&mut report.games.current_owned, enrichment);
    apply_store_enrichment_to_games(&mut report.games.not_current_owned, enrichment);
}

pub fn apply_prices_to_report(report: &mut AnalysisReport, prices: &HashMap<String, PriceInfo>) {
    apply_prices_to_games(&mut report.games.all, prices);
    apply_prices_to_games(&mut report.games.new, prices);
    apply_prices_to_games(&mut report.games.relative_new, prices);
    apply_prices_to_games(&mut report.games.overlap, prices);
    apply_prices_to_games(&mut report.games.current_owned, prices);
    apply_prices_to_games(&mut report.games.not_current_owned, prices);
}

fn build_report_game_lists(
    targets: &[TargetProfile],
    current_owned_appids: &[String],
    family_library: Option<&FamilyLibrary>,
) -> ReportGameLists {
    let current_owned_set = current_owned_appids
        .iter()
        .map(|appid| appid.as_str())
        .collect::<HashSet<_>>();
    let target_owned_set = targets
        .iter()
        .flat_map(|target| target.games.iter().map(|game| game.appid.as_str()))
        .collect::<HashSet<_>>();
    let mut game_by_id = BTreeMap::<String, ReportGame>::new();

    for target in targets {
        for game in &target.games {
            let family_game =
                family_library.and_then(|library| library.games_by_id.get(&game.appid));
            let status = if family_game.is_some() {
                "overlap"
            } else if current_owned_set.contains(game.appid.as_str()) {
                "currentOwned"
            } else if family_library.is_some() {
                "new"
            } else {
                "notCurrentOwned"
            };
            let entry = game_by_id
                .entry(game.appid.clone())
                .or_insert_with(|| ReportGame {
                    appid: game.appid.clone(),
                    name: family_game
                        .map(|family_game| family_game.name.clone())
                        .unwrap_or_else(|| game.name.clone()),
                    localized_name: String::new(),
                    store_link: game.store_link.clone(),
                    cover_url: String::new(),
                    target_owners: Vec::new(),
                    target_owner_names: Vec::new(),
                    family_owners: family_game
                        .map(|family_game| family_game.owners.clone())
                        .unwrap_or_default(),
                    family_owner_names: family_game
                        .map(|family_game| resolve_family_owner_names(family_game, family_library))
                        .unwrap_or_default(),
                    family_acquired_at: family_game
                        .map(|family_game| family_game.acquired_at)
                        .unwrap_or(0),
                    prices: ReportGamePrices::default(),
                    price: None,
                    status: status.to_string(),
                });

            if !entry
                .target_owners
                .iter()
                .any(|steamid| steamid == &target.steamid64)
            {
                entry.target_owners.push(target.steamid64.clone());
            }
            if !entry
                .target_owner_names
                .iter()
                .any(|name| name == &target.display_name)
            {
                entry.target_owner_names.push(target.display_name.clone());
            }
        }
    }

    let mut all = game_by_id.into_values().collect::<Vec<_>>();
    all.sort_by(compare_report_games);
    let new = all
        .iter()
        .filter(|game| game.status == "new")
        .cloned()
        .collect::<Vec<_>>();
    let overlap = all
        .iter()
        .filter(|game| game.status == "overlap")
        .cloned()
        .collect::<Vec<_>>();
    let mut relative_new = family_library
        .map(|library| {
            library
                .games_by_id
                .iter()
                .filter(|(appid, _)| !target_owned_set.contains(appid.as_str()))
                .map(|(appid, family_game)| ReportGame {
                    appid: appid.clone(),
                    name: family_game.name.clone(),
                    localized_name: String::new(),
                    store_link: format!("https://store.steampowered.com/app/{appid}/"),
                    cover_url: String::new(),
                    target_owners: Vec::new(),
                    target_owner_names: Vec::new(),
                    family_owners: family_game.owners.clone(),
                    family_owner_names: resolve_family_owner_names(family_game, family_library),
                    family_acquired_at: family_game.acquired_at,
                    prices: ReportGamePrices::default(),
                    price: None,
                    status: "relativeNew".to_string(),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    relative_new.sort_by(compare_report_games);
    let current_owned = all
        .iter()
        .filter(|game| game.status == "currentOwned")
        .cloned()
        .collect::<Vec<_>>();
    let not_current_owned = all
        .iter()
        .filter(|game| game.status != "currentOwned")
        .cloned()
        .collect::<Vec<_>>();

    ReportGameLists {
        all,
        new,
        relative_new,
        overlap,
        current_owned,
        not_current_owned,
    }
}

fn resolve_family_owner_names(
    family_game: &crate::models::FamilyGame,
    family_library: Option<&FamilyLibrary>,
) -> Vec<String> {
    family_game
        .owners
        .iter()
        .map(|steamid| {
            family_library
                .and_then(|library| library.owner_names_by_id.get(steamid))
                .cloned()
                .unwrap_or_else(|| steamid.clone())
        })
        .collect()
}

fn compare_report_games(left: &ReportGame, right: &ReportGame) -> std::cmp::Ordering {
    left.name
        .to_lowercase()
        .cmp(&right.name.to_lowercase())
        .then_with(|| left.appid.cmp(&right.appid))
}

fn apply_store_enrichment_to_games(
    games: &mut [ReportGame],
    enrichment: &HashMap<String, StoreItemEnrichment>,
) {
    for game in games {
        if let Some(item) = enrichment.get(&game.appid) {
            if !item.localized_name.is_empty() {
                game.localized_name = item.localized_name.clone();
            }
            if !item.cover_url.is_empty() {
                game.cover_url = item.cover_url.clone();
            }
            game.prices.original = item.price.clone();
            game.price = item.price.clone();
        }
    }
}

fn apply_prices_to_games(games: &mut [ReportGame], prices: &HashMap<String, PriceInfo>) {
    for game in games {
        if let Some(price) = prices.get(&game.appid) {
            game.prices.history_low = Some(price.clone());
            game.price = Some(price.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{FamilyGame, TargetGame};

    #[test]
    fn report_games_are_deduped_and_classified_by_current_owned_set() {
        let targets = vec![
            test_target(
                "76561190000000001",
                "Alice",
                vec![test_game("10", "Alpha"), test_game("20", "Beta")],
            ),
            test_target(
                "76561190000000002",
                "Bob",
                vec![test_game("20", "Beta"), test_game("30", "Gamma")],
            ),
        ];

        let report = build_analysis_report(targets, &["20".to_string()], None, Vec::new());
        let beta = report
            .games
            .all
            .iter()
            .find(|game| game.appid == "20")
            .expect("deduped shared game should exist");

        assert_eq!(report.games.all.len(), 3);
        assert_eq!(report.games.current_owned.len(), 1);
        assert_eq!(report.games.not_current_owned.len(), 2);
        assert_eq!(report.current_owned_overlap_count, 1);
        assert_eq!(beta.status, "currentOwned");
        assert_eq!(
            beta.target_owners,
            vec!["76561190000000001", "76561190000000002"]
        );
        assert_eq!(beta.target_owner_names, vec!["Alice", "Bob"]);
    }

    #[test]
    fn report_games_use_family_overlap_before_current_owned_classification() {
        let targets = vec![test_target(
            "76561190000000001",
            "Alice",
            vec![
                test_game("10", "Alpha"),
                test_game("20", "Beta"),
                test_game("30", "Gamma"),
            ],
        )];
        let family_library = FamilyLibrary {
            games_by_id: HashMap::from([(
                "20".to_string(),
                FamilyGame {
                    name: "Beta Family".to_string(),
                    owners: vec!["76561190000000099".to_string()],
                    acquired_at: 123,
                },
            )]),
            owner_names_by_id: HashMap::from([(
                "76561190000000099".to_string(),
                "Carol".to_string(),
            )]),
        };

        let report = build_analysis_report(
            targets,
            &["20".to_string(), "30".to_string()],
            Some(&family_library),
            Vec::new(),
        );
        let overlap = report
            .games
            .all
            .iter()
            .find(|game| game.appid == "20")
            .expect("family overlap should exist");

        assert_eq!(report.family_game_count, 1);
        assert_eq!(report.new_game_count, 1);
        assert_eq!(report.overlap_count, 1);
        assert_eq!(report.current_owned_overlap_count, 1);
        assert_eq!(overlap.status, "overlap");
        assert_eq!(overlap.name, "Beta Family");
        assert_eq!(overlap.family_owners, vec!["76561190000000099"]);
        assert_eq!(overlap.family_owner_names, vec!["Carol"]);
    }

    fn test_target(steamid64: &str, display_name: &str, games: Vec<TargetGame>) -> TargetProfile {
        TargetProfile {
            steamid64: steamid64.to_string(),
            display_name: display_name.to_string(),
            profile_url: format!("https://steamcommunity.com/profiles/{steamid64}"),
            avatar: String::new(),
            game_count: games.len(),
            raw_game_count: games.len(),
            sample_games: games.iter().take(30).cloned().collect(),
            games,
        }
    }

    fn test_game(appid: &str, name: &str) -> TargetGame {
        TargetGame {
            appid: appid.to_string(),
            name: name.to_string(),
            store_link: format!("https://store.steampowered.com/app/{appid}/"),
        }
    }
}
