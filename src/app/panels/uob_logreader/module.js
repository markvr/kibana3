/** @scratch /panels/5
 *
 * include::panels/table.asciidoc[]
 */

/** @scratch /panels/log_reader/0
 *
 * == table
 * Status: *Stable*
 *
 * Provides a panel that can be used to read unstructured logs.  If the "file.raw" and "host.raw"
 * filters are set
 *
 */
define([
  'angular',
  'app',
  'lodash',
  'kbn',
  'moment',
],
    function (angular, app, _, kbn, moment) {
      'use strict';

      var module = angular.module('kibana.panels.uob_logreader', []);
      app.useModule(module);

      module.controller('uob_logreader', function ($rootScope, $scope, $modal, $q, $compile, fields, querySrv, dashboard, filterSrv) {
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
            {
              title: 'Queries',
              src: 'app/partials/querySelect.html'
            }
          ],
          status: "Stable",
          description: "UoB Log Reader"
        };

        // Set and populate defaults
        var _d = {
          /** @scratch /panels/table/5
           * === Parameters
           *
           * size:: The number of hits to show per page
           */
          loadSize: 1000, // Per page
          /** @scratch /panels/table/5
           * pages:: The number of pages available
           */

          timeField: '@timestamp',
          /** @scratch /panels/table/5
           * spyable:: Set to false to disable the inspect icon
           */
          spyable: true,
          /** @scratch /panels/table/5
           *
           * ==== Queries
           * queries object:: This object describes the queries to use on this panel.
           * queries.mode::: Of the queries available, which to use. Options: +all, pinned, unpinned, selected+
           * queries.ids::: In +selected+ mode, which query ids are selected.
           */
          queries: {
            mode: 'all',
            ids: []
          },
          style: {'font-size': '9pt'},
          normTimes: true,
        };
        _.defaults($scope.panel, _d);

        $scope.offset;
        $scope.log_timestamp;
        $scope.data = [];

        $scope.disable_refresh = false;

        $scope.init = function () {
          console.log("logreader: refreshing data")
          $scope.$on('refresh', function () {
            $scope.get_data();
          });
          $scope.get_data();
        };


        $scope.set_sort = function (field) {
          if ($scope.panel.sort[0] === field) {
            $scope.panel.sort[1] = $scope.panel.sort[1] === 'asc' ? 'desc' : 'asc';
          } else {
            $scope.panel.sort[0] = field;
          }
          $scope.get_data();
        };

        $scope.toggle_field = function (field) {
          if (_.indexOf($scope.panel.fields, field) > -1) {
            $scope.panel.fields = _.without($scope.panel.fields, field);
            delete $scope.columns[field];
          } else {
            $scope.panel.fields.push(field);
            $scope.columns[field] = true;
          }
        };

        $scope.toggle_highlight = function (field) {
          if (_.indexOf($scope.panel.highlight, field) > -1) {
            $scope.panel.highlight = _.without($scope.panel.highlight, field);
          } else {
            $scope.panel.highlight.push(field);
          }
        };

        $scope.pick_line = function (row) {

        };


        $scope.set_offset = function (offset) {
          _.each(filterSrv.list, function (filterProps) {
            if (filterProps.field === "offset") {
              filterSrv.remove(filterProps.id, true);
              filterSrv.set({type: 'terms', field: "offset", value: offset, mandate: ('must'), active: false});
            }
          });
        };


        $scope.get_filterValues = function() {
          var filterValues = {"file.raw" : undefined, "host.raw": undefined , "offset" : undefined, "log_timestamp" : undefined};
          var filterCounts = {"file.raw":0, "host.raw":0, "offset":0, "log_timestamp":0}

          _.each(filterSrv.list(), function (filterProps) {
            // Count how many filters of each type we have and save the values
            if (Object.keys(filterCounts).indexOf(filterProps.field) !== -1) {
              filterCounts[filterProps.field]++;
              filterValues[filterProps.field] = filterProps.value;
            }
          });
          if (filterCounts["file.raw"] !== 1) {
            console.log("Got " + filterCounts["file.raw"]  + " for file.raw, but need exactly one");
            return;
          }
          if (filterCounts["host.raw"] !== 1) {
            console.log("Got " + filterCounts["host.raw"]  + " for host.raw, but need exactly one")
            return;
          }
          if (filterCounts["log_timestamp"] === 0) {
            filterValues["log_timestamp"] = "end"
          } else if (filterCounts["log_timestamp"] > 1) {
            console.log("Got " + filterCounts["log_timestamp"]  + " for log_timestamp, but need exactly zero or one")
            return;
          }
          $scope.host = filterValues["host.raw"];
          $scope.file = filterValues["file.raw"];
          $scope.log_timestamp = filterValues["log_timestamp"];

          if (filterCounts["offset"] === 1) {
            $scope.offset = filterValues["offset"];
          }
          return filterValues;
        }

        $scope.do_query = function (timestamp, offset, direction, equal_to) {
          var filters = [];
          var filterValues = $scope.get_filterValues();
          // filterSrv.getEjsObj() returns false if the filter is in-active, so we need to manually create it ourselves
          filters.push($scope.ejs.TermFilter("file.raw", filterValues["file.raw"]));
          filters.push($scope.ejs.TermFilter("host.raw", filterValues["host.raw"]));

          if (typeof(equal_to) === "undefined") equal_to = true;

          if (typeof(timestamp) !== "undefined" && typeof(offset) !== "undefined") {
            var timeRangeFilter = $scope.ejs.RangeFilter("@timestamp");
            var offsetRangeFilter = $scope.ejs.RangeFilter("offset");
            if (direction === "desc" && equal_to === true) {
              timeRangeFilter.lte(timestamp);
              offsetRangeFilter.lte(offset);
            } else if (direction === "desc" && equal_to === false) {
              timeRangeFilter.lt(timestamp);
              offsetRangeFilter.lt(offset);
            } else if (direction === "asc" && equal_to === true) {
              timeRangeFilter.gte(timestamp)
              offsetRangeFilter.gte(offset)
            } else if (direction === "asc" && equal_to === false) {
              timeRangeFilter.gt(timestamp)
              offsetRangeFilter.gt(offset)
            }
            filters.push(offsetRangeFilter);
            filters.push(timeRangeFilter);
          }

          var boolFilter = $scope.ejs.BoolFilter();
          boolFilter.must(filters);
          var filteredQuery = $scope.ejs.FilteredQuery(
              $scope.ejs.QueryStringQuery("*"),
              boolFilter
          );

          var sort = $scope.ejs.Sort("@timestamp").order(direction);
          var request = $scope.ejs.Request().indices(dashboard.indices);
          request = request.query(filteredQuery)
            .size($scope.panel.loadSize)
            .sort(sort);

          return request.doSearch();
        }

        $scope.handle_results = function(promises) {
          var data = $scope.data;
          $q.all(promises).then(function (results) {
            _.each(results, function (result) {
              if (!(_.isUndefined(results.error))) {
                $scope.panel.error = $scope.parse_error(results.error);
                return; // how do we return all the way out of handle_results?
              }
              _.each(result.hits.hits, function(hit) {
                data.push(hit._source);
              });
            });

            $scope.panelMeta.loading = false;
          // Sort it back into ascending order
            var rows = _.sortByAll(data, ["@timestamp", "offset"]);

            $scope.data = rows;
          });
        }

        $scope.get_data = function (position) {
          // The enabling/disabling of filters in uob_results causes excessive amounts
          // of refreshes.  Do some "flood control" so only one request is sent per results click
          if ($scope.disable_refresh) return;
          $scope.disable_refresh = true;
          setTimeout(function() {
            $scope.disable_refresh = false;
          }, 100)

          var
              request,
              boolQuery;

          $scope.panel.error = false;

          $scope.panelMeta.loading = true;

          // Make sure we have everything for the request to complete
          if (dashboard.indices.length === 0) {
            return;
          }

          $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);

          // Reset the data because we are loading a new location
          $scope.data = [];

          var filterValues = $scope.get_filterValues();
          if (typeof(filterValues["log_timestamp"]) === "undefined") {
            // We don't have an timestamp so default to end of file
            $scope.handle_results([$scope.do_query(undefined, undefined,  "desc")]);
          } else {
            var queries = [
              $scope.do_query(filterValues["log_timestamp"], filterValues["offset"], "desc", false),
              $scope.do_query(filterValues["log_timestamp"], filterValues["offset"], "asc", true),
            ]
            $scope.handle_results(queries);
          }
        }

        $scope.load_more = function(position) {
          var query;
          $scope.panelMeta.loading = true;
          if (position === "top") {
            var timestamp = $scope.data[0]["@timestamp"]
            var offset = $scope.data[0]["offset"]
            query = $scope.do_query(timestamp, offset, "desc", false);
          } else if(position === "bottom") {
            var timestamp = $scope.data[$scope.data.length-1]["@timestamp"];
            var offset = $scope.data[$scope.data.length-1]["offset"];
            query = $scope.do_query(timestamp, offset, "asc", false);
          }
          $scope.handle_results([query])

        }

        $scope.goto = function(position) {
          var query;
          $scope.panelMeta.loading = true;
          $scope.data = [];
          if (position === "start") {
            query = $scope.do_query(undefined, undefined, "asc", true)
          } else if (position === "end") {
            query = $scope.do_query(undefined, undefined, "desc", true)
          }
          $scope.handle_results([query]);


        }


        $scope.isSelected = function (timestamp, offset) {
          return (offset === $scope.offset && timestamp === $scope.log_timestamp);
        };

        $scope.page = function (page) {
          $scope.panel.offset = page * $scope.panel.size;
          $scope.get_data();
        };


        $scope.set_refresh = function (state) {
          $scope.refresh = state;
        };

        $scope.close_edit = function () {
          if ($scope.refresh) {
            $scope.get_data();
          }
          $scope.columns = [];
          _.each($scope.panel.fields, function (field) {
            $scope.columns[field] = true;
          });
          $scope.refresh = false;
        };


      });

      // This also escapes some xml sequences
      module.filter('tableHighlight', function () {
        return function (text) {
          if (!_.isUndefined(text) && !_.isNull(text) && text.toString().length > 0) {
            return text.toString().
                replace(/&/g, '&amp;').
                replace(/</g, '&lt;').
                replace(/>/g, '&gt;').
                replace(/\r?\n/g, '<br/>').
                replace(/@start-highlight@/g, '<code class="highlight">').
                replace(/@end-highlight@/g, '</code>');
          }
          return '';
        };
      });

      module.filter('tableTruncate', function () {
        return function (text, length, factor) {
          if (!_.isUndefined(text) && !_.isNull(text) && text.toString().length > 0) {
            return text.length > length / factor ? text.substr(0, length / factor) + '...' : text;
          }
          return '';
        };
      });



      module.filter('tableJson', function () {
        var json;
        return function (text, prettyLevel) {
          if (!_.isUndefined(text) && !_.isNull(text) && text.toString().length > 0) {
            json = angular.toJson(text, prettyLevel > 0 ? true : false);
            json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            if (prettyLevel > 1) {
              /* jshint maxlen: false */
              json = json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
                var cls = 'number';
                if (/^"/.test(match)) {
                  if (/:$/.test(match)) {
                    cls = 'key strong';
                  } else {
                    cls = '';
                  }
                } else if (/true|false/.test(match)) {
                  cls = 'boolean';
                } else if (/null/.test(match)) {
                  cls = 'null';
                }
                return '<span class="' + cls + '">' + match + '</span>';
              });
            }
            return json;
          }
          return '';
        };
      });

      // WIP
      module.filter('tableLocalTime', function () {
        return function (text, event) {
          return moment(event.sort[1]).format("YYYY-MM-DDTHH:mm:ss.SSSZ");
        };
      });

    });
