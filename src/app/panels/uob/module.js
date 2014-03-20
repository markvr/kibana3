/** @scratch /panels/5
 * include::panels/terms.asciidoc[]
 */

/** @scratch /panels/terms/0
 * == terms
 * Status: *Stable*
 *
 * A table, bar chart or pie chart based on the results of an Elasticsearch terms facet.
 *
 */
define([
  'angular',
  'app',
  'underscore',
  'jquery',
  'kbn'
],
function (angular, app, _, $, kbn) {
  'use strict';

  var module = angular.module('kibana.panels.uob', []);
  app.useModule(module);

  module.controller('uob', function($scope, querySrv, dashboard, filterSrv, $q) {
    $scope.panelMeta = {
      modals : [
        {
          description: "Inspect",
          icon: "icon-info-sign",
          partial: "app/partials/inspector.html",
          show: $scope.panel.spyable
        }
      ],
      editorTabs : [
        {title:'Queries', src:'app/partials/querySelect.html'}
      ],
      status  : "Stable",
      description : "Displays the results of an elasticsearch facet as a pie chart, bar chart, or a "+
        "table"
    };

    // Set and populate defaults
    var _d = {
      /** @scratch /panels/terms/5
       * === Parameters
       *
       * field:: The field on which to computer the facet
       */
      field   : 'tag_', 
      /** @scratch /panels/terms/5
       * exclude:: terms to exclude from the results
       */
      exclude : [],
      /** @scratch /panels/terms/5
       * missing:: Set to false to disable the display of a counter showing how much results are
       * missing the field
       */
      missing : true,
      /** @scratch /panels/terms/5
       * other:: Set to false to disable the display of a counter representing the aggregate of all
       * values outside of the scope of your +size+ property
       */
      other   : true,
      /** @scratch /panels/terms/5
       * size:: Show this many terms
       */
      size    : 10,
      /** @scratch /panels/terms/5
       * order:: count, term, reverse_count or reverse_term
       */
      order   : 'term',
      style   : { "font-size": '10pt'},
      /** @scratch /panels/terms/5
       * chart:: table, bar or pie
       */
      chart       : 'table',
      /** @scratch /panels/terms/5
       * spyable:: Set spyable to false to disable the inspect button
       */
      spyable     : true,
      /** @scratch /panels/terms/5
       * ==== Queries
       * queries object:: This object describes the queries to use on this panel.
       * queries.mode::: Of the queries available, which to use. Options: +all, pinned, unpinned, selected+
       * queries.ids::: In +selected+ mode, which query ids are selected.
       */
      queries     : {
        mode        : 'all',
        ids         : []
      },
    };
    _.defaults($scope.panel,_d);
    
    $scope.level = 0;
    
    
    
    // Array to hold a sequence of objects defining terms that have been selected.
    // selectedTerm = {filterSrvId : <id>, term: <string>}
    var selectedTermsList = [];
    

    
    
    $scope.init = function () {
      $scope.hits = 0;

      $scope.$on('refresh',function(){
        $scope.get_data();
      });
      $scope.get_data();

    };


    $scope.isSelected = function(term, level) {
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
    $scope.get_data = function() { 
          
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
      $scope.data = [];

      var promises = [];

      $scope.panelMeta.loading = true; 
      var minTimeBetweenAjaxRequests = 300; // milliseconds()
      
      for(var level = 0; level <= selectedTermsList.length; level++) {
        
        // Ugly ugly ugly hack....mod_auth_cas breaks if requests are too close together (throws error 
        // " Cookie 'ae9afb895277b6e384a7c57d6350cc42' is corrupt or invalid," in Apache error logs), so this spaces 
        // requests by the specified time - found by trial and error.
        var currentMillis = (new Date).getMilliseconds();
        while ((new Date).getMilliseconds() !== ((currentMillis + minTimeBetweenAjaxRequests) % 1000));
        console.log("Requesting data for level " + level + " at: " + (new Date).getMilliseconds());

        var field  = $scope.panel.field + level; // e.g. "tag_0"
      
        if(dashboard.indices.length === 0) {
          return;
        }

        // Set the spinner visible on the meta panel
        $scope.panelMeta.loading = true;

        var request,
          results,
          boolQuery,
          queries;

        request = $scope.ejs.Request().indices(dashboard.indices);

        // This gets the *queries* - entries in the search box etc.  We want all of these
        $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);
        queries = querySrv.getQueryObjs($scope.panel.queries.ids);
        boolQuery = $scope.ejs.BoolQuery();
        _.each(queries,function(q) {
          boolQuery = boolQuery.should(querySrv.toEjsObj(q));
        });
 
        // Now the *filters* - these are more complex because we need to build them up in turn for each level.
        // Get a list of filter IDs with no selectedTerm filters...
        var filterIds = _.difference(filterSrv.ids, _.pluck(selectedTermsList, "filterSrvId"));
        //... then add back in any that we have reached so far.  
        // For level == 0, we don't have any filters
        // Then when level == 1, add the first (e.g. tag_0) filter, and so on.
        for (var i = 0; i < level; i++) {
          filterIds.push(selectedTermsList[i].filterSrvId);
        }

        var filters = filterSrv.getBoolFilter(filterIds);

        // Terms mode
        request
          .facet($scope.ejs.TermsFacet('terms')
            .field(field)
            .size($scope.panel.size)
            .order($scope.panel.order)
            .exclude($scope.panel.exclude)
            .facetFilter($scope.ejs.QueryFilter(
              $scope.ejs.FilteredQuery(
                boolQuery,
                filters
                )))).size(0);

        // Populate the inspector panel
        $scope.inspector = angular.toJson(JSON.parse(request.toString()),true);


        // Populate scope when we have results
        promises.push(request.doSearch().then(function(results) {
          return results;
        }));
      }
      
      $q.all(promises).then(function(results) {
        var selectedTermsToRemove = [];
        _.each(results,function(result, level) {
            if (result.facets.terms.terms.length > 0) {
              $scope.data[level] = [];
              _.each(result.facets.terms.terms, function(v) {
                $scope.data[level].push({ label : v.term, count : v.count});
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
    $scope.build_search = function(term, level) {
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
        selectedTerm.filterSrvId =  filterSrv.set({type:'terms', field:$scope.panel.field + level, value:term.label, mandate:('must')});
        selectedTermsList.push(selectedTerm);
      } else {
        // Other wise just refresh so the filter removals above take effect.
        dashboard.refresh();
      }

    };

    $scope.set_refresh = function (state) {
      $scope.refresh = state;
    };

    $scope.close_edit = function() {
      if($scope.refresh) {
        $scope.get_data();
      }
      $scope.refresh =  false;
      $scope.$emit('render');
    };

    $scope.showMeta = function(term) {
      if(_.isUndefined(term.meta)) {
        return true;
      }
      if(term.meta === 'other' && !$scope.panel.other) {
        return false;
      }
      if(term.meta === 'missing' && !$scope.panel.missing) {
        return false;
      }
      return true;
    };

  });

  
});