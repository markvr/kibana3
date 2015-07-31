/**
 * A panel that uses "tags" added to the logs to provide an easy way to drill down into logs
 *
 * "Tags" are simply log fields prefixed with a given text and an integer increment.  e.g. a prefix of "tag_",
 * uses a list of fields called "tag_0", "tag_1" etc.
 *
 * Tags should have a logical hierarchy in the log domain.  They are then displayed in columns in the panel, i.e.
 * column 0 lists all distinct values for tag_0.  When an entry in column 0 is selected, then column 1 lists all
 * distinct values for log entries that have tag_0 == the selected entry in column 0.  It's simpler than it sounds!
 *
 */
define([
  'angular',
  'app',
  'lodash',
  'jquery',
  'kbn'
],
        function (angular, app, _, $, kbn) {
          'use strict';

          var module = angular.module('kibana.panels.uob_tags', []);
          app.useModule(module);

          module.controller('uob_tags', function ($scope, querySrv, dashboard, filterSrv, $q) {
            $scope.panelMeta = {
              modals: [
                {
                  description: "Inspect",
                  icon: "icon-info-sign",
                  partial: "app/partials/inspector.html",
                  show: $scope.panel.spyable
                }
              ],
              editorTabs: [
                {title: 'Queries', src: 'app/partials/querySelect.html'}
              ],
              status: "Stable",
              description: "Uses supplied tags to provide a hierarchy to find logs"
            };

            // Set and populate defaults
            var _d = {
              tags: ['tag'], // csv
              order: 'term',
              style: {"font-size": '10pt'},
              spyable: true,
              /** @scratch /panels/terms/5
               * ==== Queries
               * queries object:: This object describes the queries to use on this panel.
               * queries.mode::: Of the queries available, which to use. Options: +all, pinned, unpinned, selected+
               * queries.ids::: In +selected+ mode, which query ids are selected.
               */
              queries: {
                mode: 'all',
                ids: []
              },
            };

            _.defaults($scope.panel, _d);  // Set the defaults onto the panel

            $scope.level = 0; // The level of tags that is selected.  Start at 0.

            // Array to hold a sequence of objects defining terms that have been selected.
            // selectedTerm = {filterSrvId : <id>, term: term}
            var selectedTermsList = [];

            $scope.init = function () {
              $scope.hits = 0;

              // Used in case we are loading from a saved configuration that contains selected tags
              // Iterate over the existing filters, and find any that match our tag prefix.  If they do,
              // then add them to the selectedTerms list.
              _.each(filterSrv.list, function (filter) {
                if (typeof filter.field !== "undefined" && filter.field.indexOf($scope.panel.field) !== -1) {
                  var field_num = parseInt(filter.field.split($scope.panel.field)[1]);
                  selectedTermsList[field_num] = {"filterSrvId": filter.id, "term": {"label": filter.value}};
                }
              });

              $scope.$on('refresh', function () {
                $scope.get_data();
              });

              $scope.get_data();
            };


            $scope.isSelected = function (term, level) {
              if (typeof selectedTermsList[level] !== "undefined" && selectedTermsList[level].term.label === term.label) {
                return true;
              } else {
                return false;
              }
            }

            /**
             * Refreshes $scope.data, which is bound to the view.
             * @returns {nothing}
             */
            $scope.get_data = function () {

              /*
               * This runs each time a term is selected, or the time range changes.  If the time range changes, we need to
               * run it from the beginning level again, because the term counts will have changed, and the selected term(s)
               * might not even exist any more.
               *
               * So we need to run a query for tag_0, with no selectedTerm filters to get the terms & counts for the time range.
               * Then, if the selectedTerm *is* available in the returned terms, enable the filter for that term, and run a query
               * for the next level terms.
               * And repeat.
               *
               * If the selectedTerm *isn't* available in the returned terms (i.e. we've change the timerange to a point where
               * there are no log entries tagged with our selectedTerm anymore), then ideally we would stop and just return the
               * columns retrieved so far.  However, this is tricky because the data is returned async.
               *
               * So we could run in  sequence and only do the next search when the previous one has returned, but that would be
               * slow. Or we run all the searches, knowing that some will return empty, but be faster because run all queries
               * in parallel
               *.
               */

              // Array to hold the results of the queries.  Each entry corresponds to a column in the panel, and takes the form:
              // $scope.data = [
              //  [{ label : v.term, count : v.count}, ...]
              // ];
              $scope.data = [];

              // Array to hold the promises we use for the queries
              var promises = [];

              // Make the panel "loading" icon spin.
              $scope.panelMeta.loading = true;

              var minTimeBetweenAjaxRequests = 300; // milliseconds()

              for (var level = 0; level <= Math.min(selectedTermsList.length, $scope.panel.tags.length - 1); level++) {
                // Ugly ugly ugly hack....mod_auth_cas breaks if requests are too close together (throws error
                // " Cookie 'ae9afb895277b6e384a7c57d6350cc42' is corrupt or invalid," in Apache error logs), so this spaces
                // requests by the specified time - found by trial and error.
                // Not using setTimeout because don't want to get into more async complexity, hopefully Apache can be fixed
                // at some point and this can be removed
                var currentMillis = (new Date).getMilliseconds();
                while ((new Date).getMilliseconds() !== ((currentMillis + minTimeBetweenAjaxRequests) % 1000))
                  ;


                var tag = $scope.panel.tags[level];
                console.log("Requesting data for tag " + tag)

                if (dashboard.indices.length === 0) {
                  return;
                }

                var request, results, boolQuery, queries;

                request = $scope.ejs.Request().indices(dashboard.indices);

                // This gets the *queries* - entries in the search box etc.  Taken from "terms" module.js
                $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);
                queries = querySrv.getQueryObjs($scope.panel.queries.ids);
                boolQuery = $scope.ejs.BoolQuery();
                _.each(queries, function (q) {
                  boolQuery = boolQuery.should(querySrv.toEjsObj(q));
                });



                // Now the *filters* - these are more complex because we need to build them up in turn for each level.
                // Get a list of filter IDs with no selectedTerm filters, i.e. filters that we aren't managing
                // TODO: Check that this includes the time range - I don't think it does
                var filterIds = _.difference(filterSrv.ids, _.pluck(selectedTermsList, "filterSrvId"));
                //
                // Add our filters:
                // For level == 0, we don't have any filters
                // Then when level == 1, add the first (e.g. tag_0) filter, and so on.
                for (var i = 0; i < level; i++) {
                  filterIds.push(selectedTermsList[i].filterSrvId);
                }

                var filters = filterSrv.getBoolFilter(filterIds);

// my request
//                                // Configure the ejs request
                request
                        .facet($scope.ejs.TermsFacet('terms')
                                .field(tag)
                                .size($scope.panel.size)
                                .order($scope.panel.order)
                                .facetFilter($scope.ejs.QueryFilter(
                                        $scope.ejs.FilteredQuery(
                                                boolQuery,
                                                filters
                                                )))).size(0);

// "terms" request:
                request = request
                        .facet($scope.ejs.TermsFacet('terms')
                                .field(tag)
                                .size($scope.panel.size)
                                .order($scope.panel.order)
                                .facetFilter($scope.ejs.QueryFilter(
                                        $scope.ejs.FilteredQuery(
                                                boolQuery,
                                                filterSrv.getBoolFilter(filterSrv.ids())
                                                )))).size(0);



                // Populate the inspector panel
                $scope.inspector = angular.toJson(JSON.parse(request.toString()), true);

                // Add the request to our "promise" list
                promises.push(request.doSearch().then(function (results) {
                  return results;
                }));
              }


              // Using promises, so that we only update the panel when *all* the ajax requests we've fired have returned.
              // We also get the results in the order they were sent, *not* the order they return which is important.
              $q.all(promises).then(function (results) {
                var selectedTermsToRemove = [];
                _.each(results, function (result, level) {
                  if (result.facets.terms.terms.length > 0) {
                    $scope.data[level] = [];
                    _.each(result.facets.terms.terms, function (v) {
                      $scope.data[level].push({label: v.term, count: v.count});
                    });
                  } else {
                    // If we have no results, then either there are no more tag levels to go (i.e. the queried tag doesn't exist)
                    // or the time range has been moved so there are no results with the selected terms in the new time range.
                    if (level < selectedTermsList.length) {
                      // We're not at the end, so time range has moved - remove selectedTerm
                      filterSrv.remove(selectedTermsList[level].filterSrvId, true);
                      selectedTermsToRemove.push(selectedTermsList[level]);
                    }
                  }
                });
                selectedTermsList = _.difference(selectedTermsList, selectedTermsToRemove);
                $scope.$emit('render');
                $scope.panelMeta.loading = false;
              });

            };

            /**
             * Given a search term and tag level, add to the filter by concatenating the level to the field name (defined when
             * the panel was created), and setting that to the term.  e.g. for {term = "webfarm", level = 0}, add a filter of
             * "$scope.panel.field_0 == "webfarm"
             * @param {string} term The term (i.e. word) that to add to the filter
             * @param {integer} level The level we are at
             * @returns {nothing}
             */
            $scope.build_search = function (term, level) {
              var clickSelectedTerm;  // Whether the term that was clicked was already selected.  In which case, we want to
              // unselect it, and clear everything after it
              if (typeof selectedTermsList[level] !== "undefined" && selectedTermsList[level].term.label === term.label) {
                clickSelectedTerm = true;
              } else {
                clickSelectedTerm = false;
              }

              // Remove from the selectedTermsList and $scope.data the entries above and including the clicked item
              for (var i = (selectedTermsList.length - 1); i >= level; i--) {
                filterSrv.remove(selectedTermsList[i].filterSrvId, true);
                selectedTermsList.pop();

                // Remove all columns above the one that has been selected, unless we are unselecting, in which case
                // remove the selected one as well
                if (level !== i || clickSelectedTerm === true) {
                  $scope.data.pop();
                }
              }

              if (clickSelectedTerm === false) {
                // Add the newly selected term to the list
                var selectedTerm = {};
                selectedTerm.term = term;
                selectedTerm.filterSrvId = filterSrv.set({type: 'terms', field: $scope.panel.tags[level], value: term.label, mandate: ('must')});
                selectedTermsList.push(selectedTerm);
              } else {
                // Other wise just refresh so the filter removals above take effect.
                dashboard.refresh();
              }

            };

            $scope.set_refresh = function (state) {
              $scope.refresh = state;
            };

            $scope.close_edit = function () {
              if ($scope.refresh) {
                $scope.get_data();
              }
              $scope.refresh = false;
              $scope.$emit('render');
            };

            $scope.showMeta = function (term) {
              if (_.isUndefined(term.meta)) {
                return true;
              }
              if (term.meta === 'other' && !$scope.panel.other) {
                return false;
              }
              if (term.meta === 'missing' && !$scope.panel.missing) {
                return false;
              }
              return true;
            };

          });


        });